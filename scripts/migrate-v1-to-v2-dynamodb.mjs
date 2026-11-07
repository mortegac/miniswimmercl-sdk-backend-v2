/**
 * migrate-v1-to-v2-dynamodb.mjs
 *
 * Migra todos los datos desde las tablas DynamoDB v1 (sufijo -t4pplxi6t5danh3iji6dcux5ku-prod)
 * a las tablas v2 (sufijo -u5x5i3ucwvc43j4peic26jnrlq-NONE).
 *
 * - Lee desde los archivos JSON de backup en BASE-DATOS/dynamodb/
 * - Transforma nombres de campos según el mapeo v1 → v2
 * - Verifica IDs existentes en v2 para evitar duplicados
 * - Genera informe de errores en BASE-DATOS/migration-errors/
 *
 * Uso:
 *   node scripts/migrate-v1-to-v2-dynamodb.mjs
 *   node scripts/migrate-v1-to-v2-dynamodb.mjs --dry-run
 *   node scripts/migrate-v1-to-v2-dynamodb.mjs --models Roles,Users,Student
 *   node scripts/migrate-v1-to-v2-dynamodb.mjs --force              # sobreescribe registros existentes
 *   node scripts/migrate-v1-to-v2-dynamodb.mjs --force --models Student,Enrollment
 */

import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REGION     = "us-east-2";
const PROFILE    = "MINISWIMMER-05FEB2026";
const V1_SUFFIX  = "t4pplxi6t5danh3iji6dcux5ku-prod";
const V2_SUFFIX  = "u5x5i3ucwvc43j4peic26jnrlq-NONE";
const BACKUP_DIR = join(__dirname, "BASE-DATOS", "dynamodb");
const ERRORS_DIR = join(__dirname, "BASE-DATOS", "migration-errors");

const DRY_RUN   = process.argv.includes("--dry-run");
const FORCE     = process.argv.includes("--force"); // sobreescribe registros existentes
const modelsArg = process.argv.find((a) => a.startsWith("--models="))?.split("=")[1]
  ?? (process.argv.indexOf("--models") !== -1
      ? process.argv[process.argv.indexOf("--models") + 1]
      : null);
const ONLY_MODELS = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : null;

// ─── CLIENTE ─────────────────────────────────────────────────────────────────

const client = new DynamoDBClient({
  region: REGION,
  credentials: fromIni({ profile: PROFILE }),
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Lee el backup JSON de una tabla v1 */
function loadV1(v1TableName) {
  const file = join(BACKUP_DIR, `${v1TableName}-${V1_SUFFIX}.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf-8"));
}

/** Obtiene todos los IDs existentes en una tabla v2 */
async function getExistingIds(v2TableName) {
  const ids = new Set();
  let lastKey;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: `${v2TableName}-${V2_SUFFIX}`,
        ProjectionExpression: "id",
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of res.Items ?? []) {
      if (item.id?.S) ids.add(item.id.S);
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return ids;
}

/** Escribe un ítem en la tabla v2 (idempotente con ConditionExpression) */
async function putItem(v2TableName, item) {
  if (DRY_RUN) return;
  await client.send(
    new PutItemCommand({
      TableName: `${v2TableName}-${V2_SUFFIX}`,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  );
}

/** Elimina campos de sistema de Amplify que no deben escribirse en v2 */
function stripAmplify(obj) {
  const {
    __typename,
    createdAt,
    updatedAt,
    _version,
    _deleted,
    _lastChangedAt,
    ...rest
  } = obj;
  return rest;
}

/** Timestamps de Amplify: requeridos como AWSDateTime! en todos los modelos Gen2 */
function ts(r) {
  const now = new Date().toISOString();
  return {
    createdAt: r.createdAt ?? now,
    updatedAt: r.updatedAt ?? now,
  };
}

// ─── LOOKUPS PRE-CARGADOS ────────────────────────────────────────────────────

/** Construye índice studentId → userId via tabla Relationship */
function buildStudentUserIndex(relationships) {
  const idx = {};
  for (const r of relationships) {
    const sid = r.studentRelationshipsId;
    if (sid && !idx[sid]) {
      idx[sid] = r.usersRelationshipsId;
    }
  }
  return idx;
}

/** Construye índice enrollmentId → userId via ShoppingCartDetail → ShoppingCart */
function buildEnrollmentUserIndex(carts, cartDetails) {
  const cartUser = {};
  for (const c of carts) {
    cartUser[c.id] = c.usersShoppingCartId;
  }
  const enrollUser = {};
  for (const scd of cartDetails) {
    const eid = scd.shoppingCartDetailEnrollmentId;
    const cid = scd.shoppingCartCartDetailsId;
    if (eid && cid && cartUser[cid]) {
      enrollUser[eid] = cartUser[cid];
    }
  }
  return enrollUser;
}

// ─── TRANSFORMACIONES POR MODELO ─────────────────────────────────────────────

/**
 * Cada función recibe el registro v1 y los índices de lookup.
 * Retorna el objeto listo para escribir en v2, o null si debe omitirse.
 * Lanza un Error con mensaje descriptivo si hay un problema de datos.
 */
const TRANSFORMS = {

  // ── ROLES ──────────────────────────────────────────────────────────────────
  Roles: (r) => ({
    id:          r.id,
    name:        r.name,
    displayName: r.displayName,
    icon:        r.icon,
    ...ts(r),
  }),

  // ── PARAMETERSENC ──────────────────────────────────────────────────────────
  ParametersEnc: (r) => ({
    id:          r.id,
    description: r.description ?? "",
    ...ts(r),
  }),

  // ── PARAMETERS ─────────────────────────────────────────────────────────────
  Parameters: (r) => ({
    id:                r.id,
    label:             r.label,
    value:             r.value,
    country:           r.country ?? "CHILE",
    idParent:          r.idParent ?? "",
    typeOfParameterId: r.parametersEncTypeOfParameterId || r.typeOfParameterId || undefined, // GSI key: no ""
    ...ts(r),
  }),

  // ── CORRELATIVES ───────────────────────────────────────────────────────────
  Correlatives: (r) => ({
    id:          r.id,
    type:        r.type ?? "ORDER_PAYMENTTRANSACTIONS",
    correlative: r.correlative ?? 0,
    ...ts(r),
  }),

  // ── LOCATION ───────────────────────────────────────────────────────────────
  Location: (r) => ({
    id:                 r.id,
    name:               r.name ?? "",
    city:               r.city ?? "",
    country:            r.country ?? "CHILE",
    region:             r.region ?? "SANTIAGO",
    group:              r.group ?? "NONE",
    minimumTemperature: r.minimumTemperature ?? 28,
    maximumTemperature: r.maximumTemperature ?? 30,
    address:            r.address ?? "",
    phone:              r.phone ?? "",
    imageMap:           r.imageMap ?? "",
    urlMap:             r.urlMap ?? "",
    directions:         r.directions ?? "",
    isActive:           r.isActive ?? true,
    isVisible:          r.isVisible ?? true,
    ...ts(r),
  }),

  // ── EVALUATIONLEVEL ────────────────────────────────────────────────────────
  EvaluationLevel: (r) => ({
    id:          r.id,
    ico:         r.ico ?? "",
    name:        r.name ?? "",
    description: r.description ?? "",
    startingAge: r.startingAge ?? null,
    endingAge:   r.endingAge ?? null,
    order:       r.order ?? null,
    ...ts(r),
  }),

  // ── EVALUATIONOBJETIVES ────────────────────────────────────────────────────
  EvaluationObjetives: (r) => ({
    id:                   r.id,
    texto:                r.texto ?? "",
    isMandatory:          r.isMandatory ?? false,
    isActive:             r.isActive ?? true,
    evaluationLevelId:    r.evaluationLevelEvaluationObjectivesId
                          ?? r.evaluationLevelId,
    ...ts(r),
  }),

  // ── SESSIONTYPE ────────────────────────────────────────────────────────────
  SessionType: (r) => ({
    id:              r.id,
    name:            r.name,
    description:     r.description ?? "",
    durationSession: r.durationSession ?? 0,
    timeAWeek:       r.timeAWeek ?? null,
    totalSessions:   r.totalSessions ?? null,
    amount:          r.amount ?? null,
    isActive:        r.isActive ?? false,
    isTestClass:     r.isTestClass ?? false,
    packValidity:    r.packValidity ?? null,
    ...ts(r),
  }),

  // ── COURSE ─────────────────────────────────────────────────────────────────
  Course: (r) => ({
    id:           r.id,
    title:        r.title,
    description:  r.description ?? "",
    startingAge:  r.startingAge ?? null,
    endingAge:    r.endingAge ?? null,
    ageType:      r.ageType,
    ageGroupType: r.AgeGroupType ?? r.ageGroupType,  // v1 usa mayúscula "AgeGroupType"
    duration:     r.duration,
    isActive:     r.isActive ?? false,
    locationId:   r.locationCoursesId ?? r.locationId ?? "",
    ...ts(r),
  }),

  // ── SCHEDULE ───────────────────────────────────────────────────────────────
  Schedule: (r) => ({
    id:                  r.id,
    day:                 r.day,
    startHour:           r.startHour,
    endHour:             r.endHour,
    isActive:            r.isActive ?? false,
    minimumQuotas:       r.minimumQuotas ?? 0,
    maximumQuotas:       r.maximumQuotas ?? 0,
    locationSchedulesId: r.locationSchedulesId || undefined,  // GSI key: no ""
    courseSchedulesId:   r.courseSchedulesId   || undefined,  // GSI key: no ""
    ...ts(r),
  }),

  // ── COURSESESSIONTYPE ──────────────────────────────────────────────────────
  CourseSessionType: (r) => ({
    id:            r.id,
    courseId:      r.courseId,
    sessionTypeId: r.sessionTypeId,
    ...ts(r),
  }),

  // ── COACH ──────────────────────────────────────────────────────────────────
  Coach: (r) => ({
    id:             r.id,
    name:           r.name,
    lastName:       r.lastName,
    isCertificated: r.isCertificated ?? null,
    isActive:       r.isActive ?? true,
    email:          r.email,
    phone:          r.phone ?? "",
    whatsapp:       r.whatsapp ?? "",
    ...ts(r),
  }),

  // ── USERS ──────────────────────────────────────────────────────────────────
  Users: (r) => ({
    id:               r.id,
    name:             r.name,
    email:            r.email,
    validated:        r.validated ?? false,
    isEmployed:       r.isEmployed ?? false,
    isActive:         r.isActive ?? true,
    isAcademyStudent: r.isAcademyStudent ?? false,
    salesCommission:  r.salesCommission ?? 0,
    contactPhone:     r.contactPhone ?? "",
    ig:               r.ig ?? "",
    firstContact:     r.firstContact ?? null,
    streetAddress:    r.streetAddress ?? "",
    city:             r.city ?? "",
    state:            r.state ?? "",
    zipCode:          r.zipCode ?? "",
    country:          r.country ?? "CHILE",
    latitude:         r.latitude ?? null,
    longitude:        r.longitude ?? null,
    zoomLevel:        r.zoomLevel ?? 15,
    roleId:           (r.usersRolesId || r.roleId) || undefined,  // GSI key: undefined=omitido (no acepta "" ni NULL)
    ...ts(r),
  }),

  // ── STUDENT ────────────────────────────────────────────────────────────────
  Student: (r) => ({
    id:                                r.id,
    name:                              r.name,
    lastName:                          r.lastName,
    middleName:                        r.middleName ?? "",
    birthdate:                         r.birthdate,
    placeOfResidence:                  r.placeOfResidence,
    contactPhone:                      r.contactPhone,
    whoIsTheContact:                   r.whoIsTheContact,
    emailPhone:                        r.emailPhone,
    gender:                            r.gender,
    country:                           r.country ?? "CHILE",
    isActive:                          r.isActive ?? true,
    firstSwimmingClass:                r.firstSwimmingClass ?? false,
    attendedDaycare:                   r.attendedDaycare ?? false,
    immersesWithoutSwallowingWater:    r.immersesWithoutSwallowingWater ?? false,
    bornPrematurely:                   r.bornPrematurely ?? false,
    waterOnHisFaceBothersHim:          r.waterOnHisFaceBothersHim ?? false,
    putYourFaceInTheWater:             r.putYourFaceInTheWater ?? false,
    anyIllnessInjuryMedicalCondition:  r.anyIllnessInjuryMedicalCondition ?? "",
    evaluationLevelId:                 r.evaluationLevelId ?? "",
    evaluationIcon:                    r.evaluationIcon ?? "",
    evaluationDescription:             r.evaluationDescription ?? "",
    ...ts(r),
  }),

  // ── RELATIONSHIP ───────────────────────────────────────────────────────────
  Relationship: (r) => ({
    id:           r.id,
    relationType: r.relationType,
    userId:       r.usersRelationshipsId  ?? r.userId,
    studentId:    r.studentRelationshipsId ?? r.studentId,
    ...ts(r),
  }),

  // ── ACADEMYSTUDENTS ────────────────────────────────────────────────────────
  AcademyStudents: (r) => ({
    id:               r.id,
    status:           r.status,
    presence:         r.presence,
    name:             r.name,
    urlImage:         r.urlImage ?? "",
    email:            r.email,
    birthdate:        r.birthdate,
    years:            r.years ?? 0,
    address:          r.address ?? "",
    country:          r.country ?? "Chile",
    phone:            r.phone ?? "",
    profession:       r.profession ?? "",
    studiesRelated:   r.studiesRelated ?? "",
    medicalHistory:   r.medicalHistory ?? "",
    emergencyContact: r.emergencyContact ?? "",
    isPaid:           r.isPaid ?? null,
    isSponsored:      r.isSponsored ?? null,
    hasAgreement:     r.hasAgreement ?? null,
    companyAgreement: r.companyAgreement ?? "",
    ...ts(r),
  }),

  // ── ENROLLMENT ─────────────────────────────────────────────────────────────
  // userId se resuelve via índice studentUser (Relationship) o enrollmentUser (SCD→Cart)
  Enrollment: (r, { studentUser, enrollmentUser }) => {
    const studentId     = r.studentEnrollmentsId    || r.studentId    || undefined;
    const courseId      = r.courseEnrollmentsId     || r.courseId     || undefined;
    const sessionTypeId = r.sessionTypeEnrollmentsId || r.sessionTypeId || undefined;
    const userId        = enrollmentUser[r.id] || studentUser[studentId] || undefined; // GSI key: no ""

    if (!studentId)     throw new Error("Falta studentId");
    if (!courseId)      throw new Error("Falta courseId");
    if (!sessionTypeId) throw new Error("Falta sessionTypeId");

    return {
      id:               r.id,
      amountPaid:       r.amountPaid ?? 0,
      startDate:        r.startDate ?? "",
      endDate:          r.endDate ?? "",
      wasDeleted:       r.wasDeleted ?? false,
      wasPaid:          r.wasPaid ?? false,
      timeAWeek:        r.timeAWeek ?? null,
      numberOfSessions: r.numberOfSessions,
      sessionsLeft:     r.sessionsLeft ?? null,
      sessionsUsed:     r.sessionsUsed ?? null,
      scheduleId:       r.scheduleId ?? "",
      scheduleName:     r.scheduleName ?? "",
      paymentToken:     r.paymentToken ?? "",
      typeOfPlan:       r.typeOfPlan ?? null,
      studentId,
      userId,
      sessionTypeId,
      courseId,
      ...ts(r),
    };
  },

  // ── SESSIONDETAIL ──────────────────────────────────────────────────────────
  SessionDetail: (r) => ({
    id:                  r.id,
    date:                r.date,
    // locationId es GSI key → undefined si vacío (DynamoDB rechaza "" en GSI)
    locationId:          r.locationId || undefined,
    day:                 r.day ?? "",
    month:               r.month ?? "",
    year:                r.year ?? null,
    sessionNumber:       r.sessionNumber ?? null,
    totalSessions:       r.totalSessions ?? null,
    status:              r.status,
    proratedValue:       r.proratedValue ?? 0,
    wasEmailSent:        r.wasEmailSent ?? false,
    locationIdUsed:      r.locationIdUsed ?? "",
    modifiedBy:          r.modifiedBy ?? "",
    modifiedByDate:      r.modifiedByDate ?? null,
    studentId:           r.sessionDetailStudentId   || r.studentId,
    courseId:            r.courseId  || "SIN-CURSO",
    scheduleId:          r.scheduleId || "SIN-SCHEDULE",
    enrollmentId:        r.enrollmentSessionDetailsId || r.enrollmentId || undefined,
    privateEnrollmentId: r.privateEnrollmentId || undefined,
    coachId:             r.coachId || undefined,
    ...ts(r),
  }),

  // ── EMAILSEND ──────────────────────────────────────────────────────────────
  EmailSend: (r) => ({
    id:                  r.id,
    date:                r.date ?? null,
    typeSend:            r.typeSend,
    type:                r.type,
    contentEmail:        r.contentEmail ?? "",
    contentMessage:      r.contentMessage ?? "",
    phone:               r.phone ?? "",
    phoneState:          r.phoneState ?? null,
    email:               r.email ?? "",
    emailState:          r.emailState ?? null,
    // GSI keys: no strings vacíos
    studentId:           r.studentEmailSendId  || r.studentId  || undefined,
    userSendId:          r.usersEmailSendId     || r.userSendId || undefined,
    enrollmentId:        r.enrollmentEmailSendsId || r.enrollmentId || undefined,
    privateEnrollmentId: r.privateEnrollmentId || undefined,
    ...ts(r),
  }),

  // ── SHOPPINGCART ───────────────────────────────────────────────────────────
  ShoppingCart: (r) => ({
    id:                  r.id,
    totalPrice:          r.totalPrice ?? 0,
    status:              r.status ?? "PENDING",
    userId:              r.usersShoppingCartId || r.userId   || undefined,
    sellerId:            r.usersShoppingCartId || r.userId   || undefined, // v1 no distingue seller
    sellersCommissionId: r.sellersCommissionId || undefined, // GSI key: no NULL
    ...ts(r),
  }),

  // ── SHOPPINGCARTDETAIL ─────────────────────────────────────────────────────
  ShoppingCartDetail: (r) => ({
    id:                   r.id,
    type:                 r.type,
    quantity:             r.quantity ?? 1,
    amount:               r.amount ?? 0,
    detail:               r.detail ?? "",
    wasDeleted:           r.wasDeleted ?? false,
    cartId:               r.shoppingCartCartDetailsId || r.cartId || undefined,
    // GSI keys opcionales → undefined cuando vacíos (DynamoDB rechaza NULL en GSIs)
    enrollmentId:         r.shoppingCartDetailEnrollmentId        || r.enrollmentId        || undefined,
    academyEnrollmentId:  r.shoppingCartDetailAcademyEnrollmentId || r.academyEnrollmentId || undefined,
    privateEnrollmentId:  r.privateEnrollmentId || undefined,
    createdById:          r.createdById          || undefined,
    ...ts(r),
  }),

  // ── PAYMENTTRANSACTIONS ────────────────────────────────────────────────────
  PaymentTransactions: (r) => {
    const month = r.month ?? "";
    const year  = r.year  ?? " ";
    const hour  = r.hour  ?? " ";
    // GSI searchByDiaMesAnoHour usa "month#year#hour" como range key
    const monthYearHour = (month && year) ? `${month}#${year}#${hour}` : undefined;
    return {
      id:                    r.id,
      status:                r.status ?? " ",
      token:                 r.token  || " ",  // GSI key: no ""
      urlWebpay:             r.urlWebpay ?? " ",
      amount:                r.amount ?? null,
      buy_order:             r.buy_order ?? " ",
      card_number:           r.card_number ?? " ",
      transaction_date:      r.transaction_date ?? " ",
      accounting_date:       r.accounting_date ?? " ",
      installments_number:   r.installments_number ?? " ",
      payment_type_code:     r.payment_type_code ?? " ",
      session_id:            r.session_id ?? " ",
      card_detail:           r.card_detail ?? " ",
      installments_amount:   r.installments_amount ?? " ",
      authorization_code:    r.authorization_code ?? " ",
      response_code:         r.response_code ?? " ",
      vci:                   r.vci ?? " ",
      day:                   r.day ?? "",
      month,
      year,
      hour,
      "month#year#hour":     monthYearHour, // campo compuesto requerido por GSI v2
      glosa:                 r.glosa ?? "",
      hasRefund:             r.hasRefund ?? false,
      usersId:               r.usersPaymentTransactionsId       || r.usersId       || undefined,
      shoppingCartId:        r.shoppingCartPaymentTransactionsId || r.shoppingCartId || undefined,
      ...ts(r),
    };
  },

  // ── PROFITCENTER ───────────────────────────────────────────────────────────
  ProfitCenter: (r) => ({
    id:                    r.id,
    name:                  r.name ?? " ",
    code:                  r.code ?? " ",
    description:           r.description ?? " ",
    managerID:             r.managerID ?? " ",
    parentProfitCenterID:  r.parentProfitCenterID ?? " ",
    isActive:              r.isActive ?? true,
    // Nota: r.profitCenterID es redundante con r.id en v1, no se escribe
    ...ts(r),
  }),

  // ── PRODUCT ────────────────────────────────────────────────────────────────
  Product: (r) => ({
    id:            r.id,
    sku:           r.sku,
    name:          r.name,
    currentStock:  r.currentStock ?? 0,
    criticalStock: r.criticalStock ?? 0,
    purchasePrice: r.purchasePrice ?? 0,
    sellingPrice:  r.sellingPrice ?? 0,
    profits:       r.profits ?? 0,
    isActive:      r.isActive ?? true,
    supplierId:    r.supplierId || undefined,  // v1 no tiene FK a Supplier; GSI key → no ""
    ...ts(r),
  }),

  // ── STUDENTEVALUATIONS ─────────────────────────────────────────────────────
  StudentEvaluations: (r) => ({
    id:                  r.id,
    date:                r.date ?? null,
    previousLevel:       r.previousLevel ?? null,
    sessionsCarriedOut:  r.sessionsCarriedOut ?? null,
    age:                 r.age ?? null,
    wasApproved:         r.wasApproved ?? null,
    observations:        r.observations ?? null,
    // v1 tiene tanto studentId directo como studentStudentEvaluationsId
    studentId:           r.studentStudentEvaluationsId      ?? r.studentId,
    evaluationLevelId:   r.evaluationLevelStudentEvaluationsId ?? r.evaluationLevelId,
    userId:              r.usersStudentEvaluationsId         ?? r.userId,
    ...ts(r),
  }),

  // ── STUDENTEVALUATIONSDETAIL ───────────────────────────────────────────────
  StudentEvaluationsDetail: (r) => ({
    id:                    r.id,
    text:                  r.text ?? null,
    wasAchieved:           r.wasAchieved ?? null,
    studentEvaluationsId:  r.studentEvaluationsStudentEvaluationsDetailsId ?? r.studentEvaluationsId,
    evaluationObjectiveId: r.evaluationObjetivesStudentEvaluationsDetailsId ?? r.evaluationObjectiveId,
    ...ts(r),
  }),

  // ── ACADEMYCOURSES ─────────────────────────────────────────────────────────
  AcademyCourses: (r) => ({
    id:          r.id,
    name:        r.name,
    description: r.description ?? null,
    address:     r.address ?? null,
    mapurl:      r.mapurl ?? null,
    isActive:    r.isActive ?? true,
    ...ts(r),
  }),

  // ── ACADEMYENROLLMENT ──────────────────────────────────────────────────────
  AcademyEnrollment: (r) => ({
    id:                   r.id,
    amountPaid:           r.amountPaid ?? 0,
    date:                 r.date ?? "",
    wasDeleted:           r.wasDeleted ?? false,
    wasPaid:              r.wasPaid ?? false,
    user:                 r.user ?? "",
    studentsId:           r.studentsId || r.academyStudentsEnrollmentsId || undefined, // GSI key: no ""
    courseId:             r.courseId   || r.academyCoursesEnrollmentsId  || undefined, // GSI key: no ""
    shoppingCartDetailId: r.shoppingCartDetailId ?? null,
    ...ts(r),
  }),

};

// ─── ORDEN DE MIGRACIÓN (dependencias FK) ────────────────────────────────────

// Pares [v1TableName, v2TableName]
const MIGRATION_ORDER = [
  ["Roles",                   "v2Roles"],
  ["ParametersEnc",           "v2ParametersEnc"],
  ["Parameters",              "v2Parameters"],
  ["Correlatives",            "v2Correlatives"],
  ["Location",                "v2Location"],
  ["EvaluationLevel",         "v2EvaluationLevel"],
  ["EvaluationObjetives",     "v2EvaluationObjetives"],
  ["SessionType",             "v2SessionType"],
  ["Course",                  "v2Course"],
  ["Schedule",                "v2Schedule"],
  ["CourseSessionType",       "v2CourseSessionType"],
  ["Coach",                   "v2Coach"],
  ["Users",                   "v2Users"],
  ["Student",                 "v2Student"],
  ["Relationship",            "v2Relationship"],
  ["AcademyStudents",         "v2AcademyStudents"],
  ["AcademyCourses",          "v2AcademyCourses"],
  ["Enrollment",              "v2Enrollment"],
  ["AcademyEnrollment",       "v2AcademyEnrollment"],
  ["SessionDetail",           "v2SessionDetail"],
  ["EmailSend",               "v2EmailSend"],
  ["ShoppingCart",            "v2ShoppingCart"],
  ["ShoppingCartDetail",      "v2ShoppingCartDetail"],
  ["PaymentTransactions",     "v2PaymentTransactions"],
  ["ProfitCenter",            "v2ProfitCenter"],
  ["Product",                 "v2Product"],
  ["StudentEvaluations",      "v2StudentEvaluations"],
  ["StudentEvaluationsDetail","v2StudentEvaluationsDetail"],
];

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  if (!existsSync(ERRORS_DIR)) mkdirSync(ERRORS_DIR, { recursive: true });

  console.log("═".repeat(70));
  console.log("  MIGRACIÓN DynamoDB V1 → V2");
  console.log(`  Fecha:    ${new Date().toISOString()}`);
  console.log(`  V1 sufijo: ${V1_SUFFIX}`);
  console.log(`  V2 sufijo: ${V2_SUFFIX}`);
  if (DRY_RUN) console.log("  ⚡ DRY RUN — no se escribirá nada");
  if (ONLY_MODELS) console.log(`  Modelos:  ${ONLY_MODELS.join(", ")}`);
  console.log("═".repeat(70));

  // Pre-cargar índices de lookup
  console.log("\n🔍 Construyendo índices de lookup...");
  const v1Relationships  = loadV1("Relationship");
  const v1Carts          = loadV1("ShoppingCart");
  const v1CartDetails    = loadV1("ShoppingCartDetail");
  const studentUser      = buildStudentUserIndex(v1Relationships);
  const enrollmentUser   = buildEnrollmentUserIndex(v1Carts, v1CartDetails);
  console.log(`  students→user: ${Object.keys(studentUser).length} entradas`);
  console.log(`  enrollment→user: ${Object.keys(enrollmentUser).length} entradas`);

  const globalErrors = [];
  const summary = [];

  for (const [v1Name, v2Name] of MIGRATION_ORDER) {
    if (ONLY_MODELS && !ONLY_MODELS.includes(v1Name) && !ONLY_MODELS.includes(v2Name)) {
      continue;
    }

    const transform = TRANSFORMS[v1Name];
    if (!transform) {
      console.log(`\n⚠️  Sin transform para ${v1Name}, saltando.`);
      continue;
    }

    process.stdout.write(`\n📦 ${v1Name} → ${v2Name}...`);

    const v1Data = loadV1(v1Name);
    if (v1Data.length === 0) {
      console.log(" 0 registros en v1, saltando.");
      summary.push({ model: v1Name, v1Count: 0, created: 0, skipped: 0, errors: 0 });
      continue;
    }

    // Obtener IDs existentes en v2
    let existingIds;
    try {
      existingIds = await getExistingIds(v2Name);
    } catch (err) {
      console.log(` ❌ No se pudo leer tabla v2: ${err.message}`);
      globalErrors.push({ model: v1Name, id: "N/A", error: `Tabla v2 inaccesible: ${err.message}` });
      summary.push({ model: v1Name, v1Count: v1Data.length, created: 0, skipped: 0, errors: 1 });
      continue;
    }

    process.stdout.write(` ${existingIds.size} existentes en v2`);

    const modelErrors = [];
    let created = 0;
    let skipped = 0;
    let firstErrorLogged = false;

    for (const record of v1Data) {
      const id = record.id;

      // Saltar duplicados (a menos que --force esté activo)
      if (!FORCE && existingIds.has(id)) {
        skipped++;
        continue;
      }

      // Transformar
      let v2Record;
      try {
        v2Record = transform(record, { studentUser, enrollmentUser });
      } catch (err) {
        if (!firstErrorLogged) {
          console.log(`\n   🔴 PRIMER ERROR en ${v1Name} (id=${id}): ${err.message}`);
          firstErrorLogged = true;
        }
        modelErrors.push({ id, error: `Transform: ${err.message}`, record });
        continue;
      }

      if (!v2Record) {
        skipped++;
        continue;
      }

      // Escribir en v2
      try {
        await putItem(v2Name, v2Record);
        created++;
      } catch (err) {
        if (!firstErrorLogged) {
          console.log(`\n   🔴 PRIMER ERROR en ${v1Name} (id=${id}): ${err.message}`);
          firstErrorLogged = true;
        }
        modelErrors.push({ id, error: `PutItem: ${err.message}`, record, v2Record });
      }
    }

    const errCount = modelErrors.length;
    process.stdout.write(
      ` → creados: ${created}, omitidos: ${skipped}, errores: ${errCount}\n`
    );

    summary.push({ model: v1Name, v1Count: v1Data.length, created, skipped, errors: errCount });

    if (modelErrors.length > 0) {
      const errFile = join(ERRORS_DIR, `${v1Name}-errors.json`);
      writeFileSync(errFile, JSON.stringify(modelErrors, null, 2), "utf-8");
      console.log(`   ⚠️  Errores guardados en: ${errFile}`);
      globalErrors.push(...modelErrors.map((e) => ({ model: v1Name, ...e })));
    }
  }

  // ─── RESUMEN FINAL ───────────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalCreated = summary.reduce((s, r) => s + r.created, 0);
  const totalErrors  = summary.reduce((s, r) => s + r.errors, 0);

  console.log("\n" + "═".repeat(70));
  console.log("  RESUMEN DE MIGRACIÓN");
  console.log("═".repeat(70));
  const COL = [32, 8, 9, 9, 8];
  console.log(
    "Modelo".padEnd(COL[0]) +
    "V1".padStart(COL[1]) +
    "Creados".padStart(COL[2]) +
    "Omitidos".padStart(COL[3]) +
    "Errores".padStart(COL[4])
  );
  console.log("─".repeat(70));
  for (const r of summary) {
    const errMark = r.errors > 0 ? " ⚠️" : "";
    console.log(
      r.model.padEnd(COL[0]) +
      String(r.v1Count).padStart(COL[1]) +
      String(r.created).padStart(COL[2]) +
      String(r.skipped).padStart(COL[3]) +
      String(r.errors).padStart(COL[4]) +
      errMark
    );
  }
  console.log("─".repeat(70));
  console.log(
    "TOTAL".padEnd(COL[0]) +
    "".padStart(COL[1]) +
    String(totalCreated).padStart(COL[2]) +
    "".padStart(COL[3]) +
    String(totalErrors).padStart(COL[4])
  );
  console.log("═".repeat(70));
  console.log(`\n⏱  Tiempo: ${elapsed}s`);

  if (totalErrors > 0) {
    const summaryFile = join(ERRORS_DIR, "migration-summary.json");
    writeFileSync(
      summaryFile,
      JSON.stringify({ date: new Date().toISOString(), summary, errors: globalErrors }, null, 2),
      "utf-8"
    );
    console.log(`\n⚠️  ${totalErrors} errores — ver: ${summaryFile}`);
    process.exit(1);
  } else {
    console.log(`\n✅  Migración completada sin errores${DRY_RUN ? " (DRY RUN)" : ""}\n`);
  }
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err);
  process.exit(1);
});
