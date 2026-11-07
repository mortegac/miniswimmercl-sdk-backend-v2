/**
 * migrate-v1-to-v2-appsync.mjs
 *
 * Migración completa: v1 AppSync (Gen 1) → v2 AppSync (Gen 2 Amplify)
 *
 * Pasos:
 *   1. Exporta TODOS los datos del v1 vía API_KEY → guarda JSON en BASE-DATOS/
 *   2. Para cada modelo, verifica IDs existentes en v2 (evita duplicados)
 *   3. Crea los registros faltantes en v2 vía IAM (SigV4)
 *   4. Imprime resumen de migración al finalizar
 *
 * Idempotente: puede ejecutarse N veces sin duplicar datos.
 *
 * Uso:
 *   node scripts/migrate-v1-to-v2-appsync.mjs
 *   node scripts/migrate-v1-to-v2-appsync.mjs --dry-run   (solo backup, no escribe en v2)
 */

import { createHash, createHmac } from "crypto";
import { fromIni } from "@aws-sdk/credential-providers";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = join(__dirname, "BASE-DATOS");
const DRY_RUN = process.argv.includes("--dry-run");

const V1 = {
  endpoint: "https://m2hmnszh4je2rk3mdemcrudxw4.appsync-api.us-east-2.amazonaws.com/graphql",
  apiKey: "da2-ccnqqjpecvc33ijvwiphn2gjku",
};

const V2 = {
  endpoint: "https://vibghdaimbgfnlypijdjpufbgu.appsync-api.us-east-2.amazonaws.com/graphql",
  region: "us-east-2",
  profile: "MINISWIMMER-05FEB2026",
};

// ─── ESTADÍSTICAS ────────────────────────────────────────────────────────────

const stats = {};
function initStat(model) {
  stats[model] = { fetched: 0, skipped: 0, created: 0, errors: 0 };
}
function logStat(model, key) { stats[model][key]++; }

// ─── HTTP HELPERS ────────────────────────────────────────────────────────────

/** Llamada a v1 con API Key */
async function gqlV1(query, variables = {}) {
  const res = await fetch(V1.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": V1.apiKey },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/** SigV4 signing para v2 */
async function signRequest(body, credentials) {
  const url = new URL(V2.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = createHash("sha256").update(body).digest("hex");
  const headers = {
    "content-type": "application/json",
    host: url.hostname,
    "x-amz-date": amzDate,
    "x-amz-security-token": credentials.sessionToken || undefined,
  };
  const filteredHeaders = Object.fromEntries(
    Object.entries(headers).filter(([, v]) => v !== undefined)
  );
  const signedHeaders = Object.keys(filteredHeaders).sort().join(";");
  const canonicalHeaders = Object.keys(filteredHeaders)
    .sort()
    .map((k) => `${k}:${filteredHeaders[k]}`)
    .join("\n") + "\n";

  const canonicalRequest = [
    "POST", url.pathname, "",
    canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${V2.region}/appsync/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), V2.region), "appsync"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...filteredHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

let _creds = null;
async function getCreds() {
  if (!_creds) {
    const provider = fromIni({ profile: V2.profile });
    _creds = await provider();
  }
  return _creds;
}

/** Llamada a v2 con IAM SigV4 */
async function gqlV2(query, variables = {}) {
  const body = JSON.stringify({ query, variables });
  const creds = await getCreds();
  const headers = await signRequest(body, creds);
  const res = await fetch(V2.endpoint, { method: "POST", headers, body });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ─── PAGINACIÓN ──────────────────────────────────────────────────────────────

/** Obtiene todos los items paginados de v1 */
async function fetchAllV1(queryStr, dataKey, variables = {}) {
  const items = [];
  let nextToken = null;
  do {
    const data = await gqlV1(queryStr, { ...variables, limit: 1000, nextToken });
    const page = data[dataKey];
    items.push(...(page.items || []));
    nextToken = page.nextToken || null;
  } while (nextToken);
  return items;
}

/** Obtiene todos los IDs existentes en v2 */
async function fetchAllV2Ids(queryStr, dataKey) {
  const ids = new Set();
  let nextToken = null;
  do {
    const data = await gqlV2(queryStr, { limit: 1000, nextToken });
    const page = data[dataKey];
    (page?.items || []).forEach((i) => ids.add(i.id));
    nextToken = page?.nextToken || null;
  } while (nextToken);
  return ids;
}

// ─── BACKUP ──────────────────────────────────────────────────────────────────

function saveBackup(modelName, items) {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `${modelName}.json`);
  writeFileSync(file, JSON.stringify(items, null, 2), "utf-8");
  console.log(`  💾 Backup: ${file} (${items.length} registros)`);
}

// ─── LIMPIEZA ────────────────────────────────────────────────────────────────

/** Elimina campos null/undefined, __typename y arrays de relaciones */
function clean(obj, drop = []) {
  const result = {};
  const skipKeys = new Set(["__typename", ...drop]);
  for (const [k, v] of Object.entries(obj)) {
    if (skipKeys.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) continue;       // relaciones hasMany — ignorar
    if (typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date)) continue; // objetos anidados
    result[k] = v;
  }
  return result;
}

// ─── ENUM MAPPINGS ───────────────────────────────────────────────────────────

const RELATION_TYPE_MAP = {
  PARENT: "FATHER",
  SIBLING: "OTHER",
  GUARDIAN: "OTHER",
  OTHER: "OTHER",
  NONE: "NONE",
  MOTHER: "MOTHER",
  FATHER: "FATHER",
  GRANDFATHER: "GRANDFATHER",
  GRANDMOTHER: "GRANDMOTHER",
  UNCLE: "UNCLE",
  AUNT: "AUNT",
  FAMILYS_FRIEND: "FAMILYS_FRIEND",
  COUSIN: "COUSIN",
};

const SESSION_STATUS_MAP = {
  ACTIVE: "ACTIVE",
  RECOVERED: "RECOVERED",
  CANCELLED: "DELETED",
  PENDING: "ACTIVE",
  COMPLETED: "USED",
  USED: "USED",
  DELETED: "DELETED",
};

// ─── TRANSFORMACIONES v1 → v2 ────────────────────────────────────────────────

const transform = {
  Location: (r) => clean(r),

  Course: (r) => ({
    ...clean(r, ["locationCoursesId"]),
    locationId: r.locationCoursesId || null,
  }),

  Schedule: (r) => clean(r, ["locationSchedulesId", "courseSchedulesId"]),
  // v2 usa los mismos nombres locationSchedulesId / courseSchedulesId

  SessionType: (r) => clean(r),

  CourseSessionType: (r) => clean(r),

  Roles: (r) => clean(r),

  Users: (r) => ({
    ...clean(r, ["usersRolesId"]),
    roleId: r.usersRolesId || null,
  }),

  Coach: (r) => clean(r),

  Student: (r) => clean(r, ["studentSessionDetailId", "studentSessionDetailDate"]),

  Relationship: (r) => ({
    ...clean(r, ["studentRelationshipsId", "usersRelationshipsId"]),
    studentId: r.studentRelationshipsId,
    userId: r.usersRelationshipsId,
    relationType: RELATION_TYPE_MAP[r.relationType] || "OTHER",
  }),

  Enrollment: (r) => ({
    ...clean(r, [
      "courseEnrollmentsId", "sessionTypeEnrollmentsId",
      "studentEnrollmentsId", "usersEnrollmentsId",
      "enrollmentShoppingCartDetailId",
    ]),
    courseId: r.courseEnrollmentsId,
    sessionTypeId: r.sessionTypeEnrollmentsId,
    studentId: r.studentEnrollmentsId,
    userId: r.usersEnrollmentsId,
  }),

  PrivateEnrollment: (r) => ({
    ...clean(r, [
      "coursePrivateEnrollmentsId", "sessionTypePrivateEnrollmentsId",
      "studentPrivateEnrollmentsId", "usersPrivateEnrollmentsId",
      "privateEnrollmentShoppingCartDetailId",
    ]),
    courseId: r.coursePrivateEnrollmentsId,
    sessionTypeId: r.sessionTypePrivateEnrollmentsId,
    studentId: r.studentPrivateEnrollmentsId || null,
    userId: r.usersPrivateEnrollmentsId,
    coachId: r.coachPrivateEnrollmentsId || null,
  }),

  CoachSchedule: (r) => ({
    ...clean(r, ["coachCoachSchedulesId", "locationCoachSchedulesId", "scheduleCoachSchedulesId"]),
    coachId: r.coachCoachSchedulesId || r.coachId,
    locationId: r.locationCoachSchedulesId || r.locationId,
    scheduleId: r.scheduleCoachSchedulesId || r.scheduleId || null,
  }),

  SessionDetail: (r) => ({
    ...clean(r, [
      "sessionDetailStudentId",
      "enrollmentSessionDetailsId",
      "privateEnrollmentSessionDetailsId",
      "usersCoachedSessionsId",
    ]),
    studentId: r.sessionDetailStudentId,
    enrollmentId: r.enrollmentSessionDetailsId || null,
    privateEnrollmentId: r.privateEnrollmentSessionDetailsId || null,
    coachId: r.usersCoachedSessionsId || null,
    courseId: r.courseId || "SIN-CURSO",
    scheduleId: r.scheduleId || "SIN-SCHEDULE",
    status: SESSION_STATUS_MAP[r.status] || "ACTIVE",
  }),

  ShoppingCart: (r) => ({
    ...clean(r, ["usersShoppingCartId", "usersShoppingCartSellerId", "shoppingCartSellersCommissionId"]),
    userId: r.usersShoppingCartId,
    sellerId: r.usersShoppingCartSellerId || r.usersShoppingCartId,
    sellersCommissionId: r.shoppingCartSellersCommissionId || null,
    createdAt: r.createdAt || new Date().toISOString(),
  }),

  ShoppingCartDetail: (r) => ({
    ...clean(r, [
      "shoppingCartCartDetailsId", "usersShoppingCartDetailsId",
      "shoppingCartDetailEnrollmentId", "shoppingCartDetailAcademyEnrollmentId",
    ]),
    cartId: r.shoppingCartCartDetailsId,
    createdById: r.usersShoppingCartDetailsId || null,
    enrollmentId: r.shoppingCartDetailEnrollmentId || null,
    academyEnrollmentId: r.shoppingCartDetailAcademyEnrollmentId || null,
  }),

  PaymentTransactions: (r) => ({
    ...clean(r, ["shoppingCartPaymentTransactionsId", "usersPaymentTransactionsId"]),
    usersId: r.usersPaymentTransactionsId || null,
    shoppingCartId: r.shoppingCartPaymentTransactionsId || null,
  }),

  EvaluationLevel: (r) => clean(r),

  EvaluationObjetives: (r) => ({
    ...clean(r, ["evaluationLevelEvaluationObjectivesId"]),
    evaluationLevelId: r.evaluationLevelEvaluationObjectivesId || r.evaluationLevelId,
  }),

  StudentEvaluations: (r) => ({
    ...clean(r, ["evaluationLevelStudentEvaluationsId", "studentStudentEvaluationsId", "usersStudentEvaluationsId"]),
    studentId: r.studentStudentEvaluationsId || r.studentId,
    evaluationLevelId: r.evaluationLevelStudentEvaluationsId || r.evaluationLevelId,
    userId: r.usersStudentEvaluationsId || r.userId,
  }),

  SupportTicket: (r) => ({
    ...clean(r, ["studentSupportTicketsId"]),
    studentId: r.studentSupportTicketsId || null,
  }),

  EmailSend: (r) => clean(r, ["enrollmentEmailSendsId", "privateEnrollmentEmailSendsId"]),
};

// ─── QUERIES v1 ──────────────────────────────────────────────────────────────

// createdAt/updatedAt se omiten de las queries v1 — algunos registros tienen null y
// causan error de tipo en AppSync; además v2 los auto-genera al crear.
const Q_V1 = {
  Location: `query { listLocations(limit:1000) { items { id name city country region group minimumTemperature maximumTemperature address phone imageMap urlMap directions isActive isVisible } nextToken } }`,
  Course: `query { listCourses(limit:1000) { items { id title description startingAge endingAge ageType AgeGroupType duration isActive locationCoursesId } nextToken } }`,
  Schedule: `query L($nt:String) { listSchedules(limit:1000,nextToken:$nt) { items { id day startHour endHour isActive minimumQuotas maximumQuotas locationSchedulesId courseSchedulesId } nextToken } }`,
  SessionType: `query { listSessionTypes(limit:1000) { items { id name description durationSession timeAWeek totalSessions amount isActive isTestClass packValidity } nextToken } }`,
  CourseSessionType: `query L($nt:String) { listCourseSessionTypes(limit:1000,nextToken:$nt) { items { id courseId sessionTypeId } nextToken } }`,
  Roles: `query { listRoles(limit:1000) { items { id name displayName icon } nextToken } }`,
  Users: `query L($nt:String) { listUsers(limit:1000,nextToken:$nt) { items { id name email validated isEmployed isAcademyStudent salesCommission contactPhone ig firstContact streetAddress city state zipCode country latitude longitude zoomLevel usersRolesId } nextToken } }`,
  Coach: `query { listCoaches(limit:1000) { items { id name lastName isCertificated isActive email phone whatsapp } nextToken } }`,
  Student: `query L($nt:String) { listStudents(limit:1000,nextToken:$nt) { items { id name lastName middleName birthdate placeOfResidence contactPhone whoIsTheContact emailPhone gender country isActive firstSwimmingClass attendedDaycare immersesWithoutSwallowingWater bornPrematurely waterOnHisFaceBothersHim putYourFaceInTheWater anyIllnessInjuryMedicalCondition } nextToken } }`,
  Relationship: `query L($nt:String) { listRelationships(limit:1000,nextToken:$nt) { items { id relationType studentRelationshipsId usersRelationshipsId } nextToken } }`,
  Enrollment: `query L($nt:String) { listEnrollments(limit:1000,nextToken:$nt) { items { id amountPaid startDate endDate wasDeleted wasPaid timeAWeek numberOfSessions sessionsLeft sessionsUsed scheduleId scheduleName paymentToken typeOfPlan courseEnrollmentsId sessionTypeEnrollmentsId studentEnrollmentsId usersEnrollmentsId } nextToken } }`,
  PrivateEnrollment: `query L($nt:String) { listPrivateEnrollments(limit:1000,nextToken:$nt) { items { id amountPaid startDate endDate wasDeleted wasPaid timeAWeek numberOfSessions scheduleId scheduleName paymentToken typeOfPlan streetAddress city state zipCode country latitude longitude zoomLevel coursePrivateEnrollmentsId sessionTypePrivateEnrollmentsId studentPrivateEnrollmentsId usersPrivateEnrollmentsId } nextToken } }`,
  CoachSchedule: `query L($nt:String) { listCoachSchedules(limit:1000,nextToken:$nt) { items { id date startTime endTime isAvailable isBooked notes coachCoachSchedulesId locationCoachSchedulesId scheduleCoachSchedulesId } nextToken } }`,
  SessionDetail: `query L($nt:String) { listSessionDetails(limit:1000,nextToken:$nt) { items { id date locationId day month year sessionNumber totalSessions status proratedValue wasEmailSent locationIdUsed modifiedBy sessionDetailStudentId courseId scheduleId enrollmentSessionDetailsId privateEnrollmentSessionDetailsId usersCoachedSessionsId } nextToken } }`,
  ShoppingCart: `query L($nt:String) { listShoppingCarts(limit:1000,nextToken:$nt) { items { id totalPrice status createdAt usersShoppingCartId usersShoppingCartSellerId shoppingCartSellersCommissionId } nextToken } }`,
  ShoppingCartDetail: `query L($nt:String) { listShoppingCartDetails(limit:1000,nextToken:$nt) { items { id type quantity amount detail wasDeleted shoppingCartCartDetailsId usersShoppingCartDetailsId shoppingCartDetailEnrollmentId shoppingCartDetailAcademyEnrollmentId } nextToken } }`,
  PaymentTransactions: `query L($nt:String) { listPaymentTransactions(limit:1000,nextToken:$nt) { items { id status token urlWebpay amount buy_order card_number transaction_date accounting_date installments_number payment_type_code session_id card_detail installments_amount authorization_code response_code vci day month year hour glosa hasRefund shoppingCartPaymentTransactionsId usersPaymentTransactionsId } nextToken } }`,
  EvaluationLevel: `query { listEvaluationLevels(limit:1000) { items { id ico name description startingAge endingAge order } nextToken } }`,
  EvaluationObjetives: `query L($nt:String) { listEvaluationObjetives(limit:1000,nextToken:$nt) { items { id texto isMandatory isActive evaluationLevelId evaluationLevelEvaluationObjectivesId } nextToken } }`,
  StudentEvaluations: `query L($nt:String) { listStudentEvaluations(limit:1000,nextToken:$nt) { items { id date previousLevel sessionsCarriedOut age wasApproved observations studentId evaluationLevelId userId studentStudentEvaluationsId evaluationLevelStudentEvaluationsId usersStudentEvaluationsId } nextToken } }`,
  SupportTicket: `query L($nt:String) { listSupportTickets(limit:1000,nextToken:$nt) { items { id date name email phoneNumber description day month year lastModificationUser statusTicket reason studentSupportTicketsId } nextToken } }`,
  EmailSend: `query L($nt:String) { listEmailSends(limit:1000,nextToken:$nt) { items { id date typeSend type contentEmail contentMessage phone phoneState email emailState studentId userSendId enrollmentId } nextToken } }`,
};

// Mapa: queryKey → dataKey en v1
const V1_DATA_KEY = {
  Location: "listLocations", Course: "listCourses", Schedule: "listSchedules",
  SessionType: "listSessionTypes", CourseSessionType: "listCourseSessionTypes",
  Roles: "listRoles", Users: "listUsers", Coach: "listCoaches",
  Student: "listStudents", Relationship: "listRelationships",
  Enrollment: "listEnrollments", PrivateEnrollment: "listPrivateEnrollments",
  CoachSchedule: "listCoachSchedules", SessionDetail: "listSessionDetails",
  ShoppingCart: "listShoppingCarts", ShoppingCartDetail: "listShoppingCartDetails",
  PaymentTransactions: "listPaymentTransactions",
  EvaluationLevel: "listEvaluationLevels", EvaluationObjetives: "listEvaluationObjetives",
  StudentEvaluations: "listStudentEvaluations",
  SupportTicket: "listSupportTickets", EmailSend: "listEmailSends",
};

// ─── MUTATIONS v2 ────────────────────────────────────────────────────────────

const CREATE_V2 = {
  Location: `mutation C($input: CreateV2LocationInput!) { createV2Location(input:$input) { id } }`,
  Course: `mutation C($input: CreateV2CourseInput!) { createV2Course(input:$input) { id } }`,
  Schedule: `mutation C($input: CreateV2ScheduleInput!) { createV2Schedule(input:$input) { id } }`,
  SessionType: `mutation C($input: CreateV2SessionTypeInput!) { createV2SessionType(input:$input) { id } }`,
  CourseSessionType: `mutation C($input: CreateV2CourseSessionTypeInput!) { createV2CourseSessionType(input:$input) { id } }`,
  Roles: `mutation C($input: CreateV2RolesInput!) { createV2Roles(input:$input) { id } }`,
  Users: `mutation C($input: CreateV2UsersInput!) { createV2Users(input:$input) { id } }`,
  Coach: `mutation C($input: CreateV2CoachInput!) { createV2Coach(input:$input) { id } }`,
  Student: `mutation C($input: CreateV2StudentInput!) { createV2Student(input:$input) { id } }`,
  Relationship: `mutation C($input: CreateV2RelationshipInput!) { createV2Relationship(input:$input) { id } }`,
  Enrollment: `mutation C($input: CreateV2EnrollmentInput!) { createV2Enrollment(input:$input) { id } }`,
  PrivateEnrollment: `mutation C($input: CreateV2PrivateEnrollmentInput!) { createV2PrivateEnrollment(input:$input) { id } }`,
  CoachSchedule: `mutation C($input: CreateV2CoachScheduleInput!) { createV2CoachSchedule(input:$input) { id } }`,
  SessionDetail: `mutation C($input: CreateV2SessionDetailInput!) { createV2SessionDetail(input:$input) { id } }`,
  ShoppingCart: `mutation C($input: CreateV2ShoppingCartInput!) { createV2ShoppingCart(input:$input) { id } }`,
  ShoppingCartDetail: `mutation C($input: CreateV2ShoppingCartDetailInput!) { createV2ShoppingCartDetail(input:$input) { id } }`,
  PaymentTransactions: `mutation C($input: CreateV2PaymentTransactionsInput!) { createV2PaymentTransactions(input:$input) { id } }`,
  EvaluationLevel: `mutation C($input: CreateV2EvaluationLevelInput!) { createV2EvaluationLevel(input:$input) { id } }`,
  EvaluationObjetives: `mutation C($input: CreateV2EvaluationObjetivesInput!) { createV2EvaluationObjetives(input:$input) { id } }`,
  StudentEvaluations: `mutation C($input: CreateV2StudentEvaluationsInput!) { createV2StudentEvaluations(input:$input) { id } }`,
  SupportTicket: `mutation C($input: CreateV2SupportTicketInput!) { createV2SupportTicket(input:$input) { id } }`,
  EmailSend: `mutation C($input: CreateV2EmailSendInput!) { createV2EmailSend(input:$input) { id } }`,
};

const LIST_V2_IDS = {
  Location: `query L($nt:String) { listV2Locations(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Course: `query L($nt:String) { listV2Courses(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Schedule: `query L($nt:String) { listV2Schedules(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  SessionType: `query L($nt:String) { listV2SessionTypes(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  CourseSessionType: `query L($nt:String) { listV2CourseSessionTypes(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Roles: `query L($nt:String) { listV2Roles(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Users: `query L($nt:String) { listV2Users(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Coach: `query L($nt:String) { listV2Coaches(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Student: `query L($nt:String) { listV2Students(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Relationship: `query L($nt:String) { listV2Relationships(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  Enrollment: `query L($nt:String) { listV2Enrollments(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  PrivateEnrollment: `query L($nt:String) { listV2PrivateEnrollments(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  CoachSchedule: `query L($nt:String) { listV2CoachSchedules(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  SessionDetail: `query L($nt:String) { listV2SessionDetails(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  ShoppingCart: `query L($nt:String) { listV2ShoppingCarts(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  ShoppingCartDetail: `query L($nt:String) { listV2ShoppingCartDetails(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  PaymentTransactions: `query L($nt:String) { listV2PaymentTransactions(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  EvaluationLevel: `query L($nt:String) { listV2EvaluationLevels(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  EvaluationObjetives: `query L($nt:String) { listV2EvaluationObjetives(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  StudentEvaluations: `query L($nt:String) { listV2StudentEvaluations(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  SupportTicket: `query L($nt:String) { listV2SupportTickets(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
  EmailSend: `query L($nt:String) { listV2EmailSends(limit:1000,nextToken:$nt) { items { id } nextToken } }`,
};

const V2_DATA_KEY = {
  Location: "listV2Locations", Course: "listV2Courses", Schedule: "listV2Schedules",
  SessionType: "listV2SessionTypes", CourseSessionType: "listV2CourseSessionTypes",
  Roles: "listV2Roles", Users: "listV2Users", Coach: "listV2Coaches",
  Student: "listV2Students", Relationship: "listV2Relationships",
  Enrollment: "listV2Enrollments", PrivateEnrollment: "listV2PrivateEnrollments",
  CoachSchedule: "listV2CoachSchedules", SessionDetail: "listV2SessionDetails",
  ShoppingCart: "listV2ShoppingCarts", ShoppingCartDetail: "listV2ShoppingCartDetails",
  PaymentTransactions: "listV2PaymentTransactions",
  EvaluationLevel: "listV2EvaluationLevels", EvaluationObjetives: "listV2EvaluationObjetives",
  StudentEvaluations: "listV2StudentEvaluations",
  SupportTicket: "listV2SupportTickets", EmailSend: "listV2EmailSends",
};

// ─── ORDEN DE MIGRACIÓN (respetar dependencias) ───────────────────────────────

const MIGRATION_ORDER = [
  "Location",
  "Course",
  "Schedule",
  "SessionType",
  "CourseSessionType",
  "Roles",
  "Users",
  "Coach",
  "Student",
  "Relationship",
  "Enrollment",
  "PrivateEnrollment",
  "CoachSchedule",
  "SessionDetail",
  "EvaluationLevel",
  "EvaluationObjetives",
  "StudentEvaluations",
  "ShoppingCart",
  "ShoppingCartDetail",
  "PaymentTransactions",
  "SupportTicket",
  "EmailSend",
];

// ─── CORE MIGRATION ──────────────────────────────────────────────────────────

async function migrateModel(modelName) {
  process.stdout.write(`\n📦 ${modelName}...\n`);
  initStat(modelName);

  // 1. Fetch v1 → backup
  const items = await fetchAllV1(Q_V1[modelName], V1_DATA_KEY[modelName]);
  logStat(modelName, "fetched");
  stats[modelName].fetched = items.length;
  saveBackup(modelName, items);

  if (DRY_RUN) {
    console.log(`  ⏭  Dry-run: se omite escritura en v2`);
    return;
  }

  if (items.length === 0) {
    console.log(`  ℹ  Sin datos en v1`);
    return;
  }

  // 2. Fetch IDs existentes en v2
  const existingIds = await fetchAllV2Ids(LIST_V2_IDS[modelName], V2_DATA_KEY[modelName]);
  console.log(`  ✓ IDs en v2: ${existingIds.size} existentes`);

  // 3. Migrar solo los que no existen
  for (const item of items) {
    if (existingIds.has(item.id)) {
      logStat(modelName, "skipped");
      continue;
    }
    try {
      const input = transform[modelName](item);
      await gqlV2(CREATE_V2[modelName], { input });
      logStat(modelName, "created");
    } catch (err) {
      logStat(modelName, "errors");
      console.error(`  ❌ Error en ${modelName} id=${item.id}: ${err.message?.slice(0, 120)}`);
    }
  }

  const s = stats[modelName];
  console.log(`  → Creados: ${s.created} | Omitidos: ${s.skipped} | Errores: ${s.errors}`);
}

// ─── RESUMEN ─────────────────────────────────────────────────────────────────

function printSummary() {
  console.log("\n" + "═".repeat(65));
  console.log("  RESUMEN DE MIGRACIÓN");
  console.log("═".repeat(65));

  const header = `${"Modelo".padEnd(22)} ${"Exportados".padStart(10)} ${"Creados".padStart(9)} ${"Omitidos".padStart(10)} ${"Errores".padStart(9)}`;
  console.log(header);
  console.log("─".repeat(65));

  let totalFetched = 0, totalCreated = 0, totalSkipped = 0, totalErrors = 0;

  for (const model of MIGRATION_ORDER) {
    const s = stats[model] || { fetched: 0, created: 0, skipped: 0, errors: 0 };
    console.log(
      `${model.padEnd(22)} ${String(s.fetched).padStart(10)} ${String(s.created).padStart(9)} ${String(s.skipped).padStart(10)} ${String(s.errors).padStart(9)}`
    );
    totalFetched += s.fetched;
    totalCreated += s.created;
    totalSkipped += s.skipped;
    totalErrors += s.errors;
  }

  console.log("─".repeat(65));
  console.log(
    `${"TOTAL".padEnd(22)} ${String(totalFetched).padStart(10)} ${String(totalCreated).padStart(9)} ${String(totalSkipped).padStart(10)} ${String(totalErrors).padStart(9)}`
  );
  console.log("═".repeat(65));
  console.log(`\n💾 Backups guardados en: ${BACKUP_DIR}`);

  if (DRY_RUN) console.log("⚠️  Modo DRY-RUN: no se escribió nada en v2");
  if (totalErrors > 0) console.log(`⚠️  ${totalErrors} errores — revisar logs arriba`);
  else if (!DRY_RUN) console.log("✅  Migración completada sin errores");
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(65));
  console.log("  MIGRACIÓN v1 → v2 AppSync");
  console.log(`  Fecha: ${new Date().toISOString()}`);
  console.log(`  Modo:  ${DRY_RUN ? "DRY-RUN (solo backup)" : "ESCRITURA en v2"}`);
  console.log("═".repeat(65));

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  for (const model of MIGRATION_ORDER) {
    await migrateModel(model);
  }

  printSummary();
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err);
  process.exit(1);
});
