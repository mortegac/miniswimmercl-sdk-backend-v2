/**
 * sync-v1-to-v2-live.mjs
 *
 * Compara LIVE las tablas v1 (sin prefijo) contra las v2 para los modelos
 * Schedule, SessionType y CourseSessionType, agrupando diferencias por location.
 * Copia los registros faltantes de v1 a v2 preservando IDs.
 *
 * Uso:
 *   node scripts/sync-v1-to-v2-live.mjs --dry-run
 *   node scripts/sync-v1-to-v2-live.mjs
 */

import { DynamoDBClient, ScanCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";

const REGION    = "us-east-2";
const PROFILE   = "MINISWIMMER-05FEB2026";
const V1_SUFFIX = "t4pplxi6t5danh3iji6dcux5ku-prod";
const V2_SUFFIX = "u5x5i3ucwvc43j4peic26jnrlq-NONE";
const DRY_RUN   = process.argv.includes("--dry-run");

const client = new DynamoDBClient({ region: REGION, credentials: fromIni({ profile: PROFILE }) });

function ts(r) {
  const now = new Date().toISOString();
  return { createdAt: r.createdAt ?? now, updatedAt: r.updatedAt ?? now };
}

// Transformaciones v1 → v2 (idénticas a migrate-v1-to-v2-dynamodb.mjs)
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

const MODELS = ["Roles", "ParametersEnc", "Parameters", "Correlatives", "Location", "EvaluationLevel", "EvaluationObjetives", "SessionType", "Course", "Schedule", "CourseSessionType", "Coach", "Users", "Student", "Relationship", "AcademyStudents", "AcademyCourses", "Enrollment", "AcademyEnrollment", "SessionDetail", "EmailSend", "ShoppingCart", "ShoppingCartDetail", "PaymentTransactions", "ProfitCenter", "Product", "StudentEvaluations", "StudentEvaluationsDetail"];

async function scanAll(tableName) {
  const items = [];
  let lastKey;
  do {
    const res = await client.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey }));
    items.push(...(res.Items ?? []).map((i) => unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// location de un registro, resuelto vía course cuando no hay FK directa
function locationOf(model, r, courseLocation) {
  if (model === "Course") return r.locationCoursesId ?? r.locationId ?? "(sin location)";
  if (model === "SessionDetail") return r.locationId ?? "(sin location)";
  if (model === "Schedule") return r.locationSchedulesId ?? "(sin location)";
  if (model === "CourseSessionType") return courseLocation[r.courseId] ?? "(sin location)";
  if (model === "Enrollment") return courseLocation[r.courseEnrollmentsId ?? r.courseId] ?? "(sin location)";
  return "(global)"; // SessionType no tiene FK de location
}

async function main() {
  console.log(`${DRY_RUN ? "🔍 DRY-RUN" : "✍️  EJECUCIÓN REAL"}\n`);

  // índice courseId → locationId desde la tabla Course v1
  const courses = await scanAll(`Course-${V1_SUFFIX}`);
  const courseLocation = {};
  for (const c of courses) courseLocation[c.id] = c.locationCoursesId ?? c.locationId ?? "(sin location)";

  // lookups para Enrollment.userId: Relationship + ShoppingCart/Detail (v1)
  const lookups = { studentUser: {}, enrollmentUser: {} };
  if (MODELS.includes("Enrollment")) {
    const [rels, carts, cartDetails] = await Promise.all([
      scanAll(`Relationship-${V1_SUFFIX}`),
      scanAll(`ShoppingCart-${V1_SUFFIX}`),
      scanAll(`ShoppingCartDetail-${V1_SUFFIX}`),
    ]);
    for (const r of rels) {
      const sid = r.studentRelationshipsId;
      if (sid && !lookups.studentUser[sid]) lookups.studentUser[sid] = r.usersRelationshipsId;
    }
    const cartUser = {};
    for (const c of carts) cartUser[c.id] = c.usersShoppingCartId;
    for (const scd of cartDetails) {
      const eid = scd.shoppingCartDetailEnrollmentId;
      const cid = scd.shoppingCartCartDetailsId;
      if (eid && cid && cartUser[cid]) lookups.enrollmentUser[eid] = cartUser[cid];
    }
  }

  let totalMissing = 0, totalCopied = 0, totalErrors = 0;

  for (const model of MODELS) {
    const v1Table = `${model}-${V1_SUFFIX}`;
    const v2Table = `v2${model}-${V2_SUFFIX}`;

    const [v1Items, v2Items] = await Promise.all([scanAll(v1Table), scanAll(v2Table)]);
    const v2Ids = new Set(v2Items.map((i) => i.id));
    const missing = v1Items.filter((i) => !v2Ids.has(i.id));

    console.log(`═══ ${model} ═══`);
    console.log(`  v1: ${v1Items.length} registros | v2: ${v2Items.length} registros | faltantes en v2: ${missing.length}`);

    // agrupar faltantes por location
    const byLocation = {};
    for (const r of missing) {
      const loc = locationOf(model, r, courseLocation);
      (byLocation[loc] ??= []).push(r);
    }
    for (const [loc, items] of Object.entries(byLocation).sort()) {
      const detail = items.length <= 30 ? ` → ${items.map((i) => i.id).join(", ")}` : "";
      console.log(`    📍 ${loc}: ${items.length} faltantes${detail}`);
    }

    totalMissing += missing.length;

    if (!DRY_RUN && missing.length > 0) {
      for (const r of missing) {
        try {
          const item = TRANSFORMS[model](r, lookups);
          // eliminar undefined (DynamoDB no los acepta)
          Object.keys(item).forEach((k) => item[k] === undefined && delete item[k]);
          await client.send(new PutItemCommand({ TableName: v2Table, Item: marshall(item, { removeUndefinedValues: true }) }));
          totalCopied++;
        } catch (err) {
          totalErrors++;
          console.error(`    ❌ ${model} ${r.id}: ${err.message}`);
        }
      }
      console.log(`  ✅ copiados: ${missing.length - (totalErrors)} / ${missing.length}`);
    }
    console.log();
  }

  console.log(`─────────────────────────────`);
  console.log(`Total faltantes: ${totalMissing}`);
  if (!DRY_RUN) console.log(`Total copiados: ${totalCopied} | Errores: ${totalErrors}`);
  if (DRY_RUN && totalMissing > 0) console.log(`\nEjecuta sin --dry-run para copiar los faltantes.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
