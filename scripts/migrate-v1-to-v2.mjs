/**
 * Migration script: v1 DynamoDB (Gen 1) → v2 DynamoDB (Gen 2 Amplify)
 *
 * Source:  /Users/manu/_PROYECTOS/MINI-SWIMMER/_RESPALDO-BASE-DE_DATOS/01-Abril-2026
 * Target:  v2* tables in us-east-2, profile MINISWIMMER-05FEB2026
 *          Table suffix: -ggfytzhgxvd3pcnyj2mjkfenre-NONE
 *
 * Run:     node scripts/migrate-v1-to-v2.mjs
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = "/Users/manu/_PROYECTOS/MINI-SWIMMER/_RESPALDO-BASE-DE_DATOS/01-Abril-2026";
const TABLE_SUFFIX = "-ggfytzhgxvd3pcnyj2mjkfenre-NONE";
const REGION = "us-east-2";
const PROFILE = "MINISWIMMER-05FEB2026";
const MIGRATION_PLACEHOLDER_USER = "MIGRATED-NO-USER";

const client = new DynamoDBClient({
  region: REGION,
  credentials: fromIni({ profile: PROFILE }),
});
const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// ── helpers ─────────────────────────────────────────────────────────────────

function loadBackup(modelName) {
  const file = join(BACKUP_DIR, `${modelName}-t4pplxi6t5danh3iji6dcux5ku-prod.json`);
  return JSON.parse(readFileSync(file, "utf-8"));
}

function stripMeta(item) {
  // Remove v1-only fields that don't belong in v2
  const { __typename, ...rest } = item;
  return rest;
}

// Remove keys whose value is null/undefined (DynamoDB rejects null in some types)
function clean(item) {
  return Object.fromEntries(
    Object.entries(item)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
  );
}

// Keep null-safe clean: keeps empty strings as-is but removes nulls
function cleanNulls(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([, v]) => v !== null && v !== undefined)
  );
}

async function batchWrite(tableName, items) {
  const fullTableName = `v2${tableName}${TABLE_SUFFIX}`;
  let written = 0;
  const BATCH = 25;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const requests = chunk.map((item) => ({
      PutRequest: { Item: item },
    }));
    try {
      const resp = await dynamo.send(
        new BatchWriteCommand({ RequestItems: { [fullTableName]: requests } })
      );
      // Retry any unprocessed items (simple linear retry)
      let unprocessed = resp.UnprocessedItems?.[fullTableName];
      let retries = 0;
      while (unprocessed?.length && retries < 5) {
        await new Promise((r) => setTimeout(r, 200 * (retries + 1)));
        const r2 = await dynamo.send(
          new BatchWriteCommand({ RequestItems: { [fullTableName]: unprocessed } })
        );
        unprocessed = r2.UnprocessedItems?.[fullTableName];
        retries++;
      }
      written += chunk.length - (unprocessed?.length ?? 0);
    } catch (e) {
      console.error(`  ERROR writing batch to ${fullTableName}:`, e.message);
    }
  }
  return written;
}

// ── per-model transformers ───────────────────────────────────────────────────

function transformLocation(item) {
  return cleanNulls(stripMeta(item));
}

function transformRoles(item) {
  return cleanNulls(stripMeta(item));
}

function transformParametersEnc(item) {
  return cleanNulls(stripMeta(item));
}

function transformEvaluationLevel(item) {
  return cleanNulls(stripMeta(item));
}

function transformEvaluationObjetives(item) {
  const { evaluationLevelEvaluationObjectivesId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    evaluationLevelId: evaluationLevelEvaluationObjectivesId,
  });
}

function transformSessionType(item) {
  return cleanNulls(stripMeta(item));
}

function transformCoach(item) {
  return cleanNulls(stripMeta(item));
}

function transformAcademyStudents(item) {
  return cleanNulls(stripMeta(item));
}

function transformParameters(item) {
  const { parametersEncTypeOfParameterId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    typeOfParameterId: parametersEncTypeOfParameterId,
    country: item.country ?? "CHILE",  // required in v2
  });
}

function transformCourse(item) {
  const { AgeGroupType, locationCoursesId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    ageGroupType: AgeGroupType,
    locationId: locationCoursesId,
  });
}

function transformSchedule(item) {
  return cleanNulls(stripMeta(item));
}

function transformCourseSessionType(item) {
  return cleanNulls(stripMeta(item));
}

function transformUsers(item) {
  const { usersRolesId, ...rest } = stripMeta(item);
  const out = cleanNulls({ ...rest });
  // roleId is a GSI key — empty string is invalid; omit if absent
  if (usersRolesId) out.roleId = usersRolesId;
  return out;
}

function transformStudent(item) {
  return cleanNulls(stripMeta(item));
}

function transformRelationship(item) {
  const { studentRelationshipsId, usersRelationshipsId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    studentId: studentRelationshipsId,
    userId: usersRelationshipsId,
  });
}

function transformEnrollment(item) {
  const { studentEnrollmentsId, courseEnrollmentsId, sessionTypeEnrollmentsId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    studentId: studentEnrollmentsId,
    courseId: courseEnrollmentsId,
    sessionTypeId: sessionTypeEnrollmentsId,
    // userId is required in v2 but absent in v1 — use placeholder
    userId: item.userId ?? MIGRATION_PLACEHOLDER_USER,
  });
}

function transformSessionDetail(item) {
  const { sessionDetailStudentId, enrollmentSessionDetailsId, ...rest } = stripMeta(item);
  const out = cleanNulls({
    ...rest,
    studentId: sessionDetailStudentId,
    enrollmentId: enrollmentSessionDetailsId,
  });
  // scheduleId is a GSI key — empty string is invalid; use sentinel
  if (!out.scheduleId) out.scheduleId = "SIN-SCHEDULE";
  return out;
}

function transformShoppingCart(item) {
  const { usersShoppingCartId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    userId: usersShoppingCartId,
    // sellerId is required in v2 but absent in v1 — default to same userId
    sellerId: usersShoppingCartId ?? MIGRATION_PLACEHOLDER_USER,
  });
}

function transformShoppingCartDetail(item) {
  const { shoppingCartCartDetailsId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    cartId: shoppingCartCartDetailsId,
  });
}

function transformPaymentTransactions(item) {
  const {
    usersPaymentTransactionsId,
    shoppingCartPaymentTransactionsId,
    "day#month#year#hour": _compositeKey,  // v1 GSI composite key, skip
    installments_number,
    installments_amount,
    response_code,
    ...rest
  } = stripMeta(item);
  return cleanNulls({
    ...rest,
    usersId: usersPaymentTransactionsId,
    shoppingCartId: shoppingCartPaymentTransactionsId,
    // v2 stores these as strings
    installments_number: installments_number != null ? String(installments_number) : undefined,
    installments_amount: installments_amount != null ? String(installments_amount) : undefined,
    response_code: response_code != null ? String(response_code) : undefined,
  });
}

function transformEmailSend(item) {
  const { enrollmentEmailSendsId, studentEmailSendId, usersEmailSendId, ...rest } = stripMeta(item);
  return cleanNulls({
    ...rest,
    enrollmentId: enrollmentEmailSendsId,
    studentId: studentEmailSendId ?? MIGRATION_PLACEHOLDER_USER,
    userSendId: usersEmailSendId ?? MIGRATION_PLACEHOLDER_USER,
  });
}

function transformStudentEvaluations(item) {
  const {
    evaluationLevelStudentEvaluationsId,
    studentStudentEvaluationsId,
    usersStudentEvaluationsId,
    // v1 had dual fields, remove the short ones that are already present
    studentId: _s,
    evaluationLevelId: _el,
    userId: _u,
    ...rest
  } = stripMeta(item);
  return cleanNulls({
    ...rest,
    evaluationLevelId: evaluationLevelStudentEvaluationsId ?? item.evaluationLevelId,
    studentId: studentStudentEvaluationsId ?? item.studentId ?? MIGRATION_PLACEHOLDER_USER,
    userId: usersStudentEvaluationsId ?? item.userId ?? MIGRATION_PLACEHOLDER_USER,
  });
}

function transformStudentEvaluationsDetail(item) {
  const {
    evaluationObjetivesStudentEvaluationsDetailsId,
    studentEvaluationsStudentEvaluationsDetailsId,
    evaluationObjectiveId: _eo,
    studentEvaluationsId: _se,
    ...rest
  } = stripMeta(item);
  return cleanNulls({
    ...rest,
    evaluationObjectiveId:
      evaluationObjetivesStudentEvaluationsDetailsId ?? item.evaluationObjectiveId ?? MIGRATION_PLACEHOLDER_USER,
    studentEvaluationsId:
      studentEvaluationsStudentEvaluationsDetailsId ?? item.studentEvaluationsId ?? MIGRATION_PLACEHOLDER_USER,
  });
}

function transformCorrelatives(item) {
  return cleanNulls(stripMeta(item));
}

function transformProfitCenter(item) {
  const { profitCenterID, ...rest } = stripMeta(item);
  // profitCenterID is a v1-specific field not in v2 schema
  return cleanNulls(rest);
}

function transformProduct(item) {
  // v2 Product requires supplierId — not present in v1
  // Use a placeholder; these are few records (4)
  return cleanNulls({
    ...stripMeta(item),
    supplierId: MIGRATION_PLACEHOLDER_USER,
  });
}

// ── migration plan (ordered by dependencies) ────────────────────────────────

const MIGRATION_STEPS = [
  // 1. Reference data (no FKs)
  { v1: "Location",                 v2: "Location",                 transform: transformLocation },
  { v1: "Roles",                    v2: "Roles",                    transform: transformRoles },
  { v1: "ParametersEnc",            v2: "ParametersEnc",            transform: transformParametersEnc },
  { v1: "EvaluationLevel",          v2: "EvaluationLevel",          transform: transformEvaluationLevel },
  { v1: "SessionType",              v2: "SessionType",              transform: transformSessionType },
  { v1: "Coach",                    v2: "Coach",                    transform: transformCoach },
  { v1: "AcademyStudents",          v2: "AcademyStudents",          transform: transformAcademyStudents },
  { v1: "Correlatives",             v2: "Correlatives",             transform: transformCorrelatives },
  { v1: "ProfitCenter",             v2: "ProfitCenter",             transform: transformProfitCenter },
  { v1: "Product",                  v2: "Product",                  transform: transformProduct },

  // 2. Reference data with FKs to tier 1
  { v1: "Parameters",               v2: "Parameters",               transform: transformParameters },
  { v1: "EvaluationObjetives",      v2: "EvaluationObjetives",      transform: transformEvaluationObjetives },
  { v1: "Course",                   v2: "Course",                   transform: transformCourse },

  // 3. Users + Students (independent of each other)
  { v1: "Users",                    v2: "Users",                    transform: transformUsers },
  { v1: "Student",                  v2: "Student",                  transform: transformStudent },

  // 4. Schedules + CourseSessionType (depend on Course)
  { v1: "Schedule",                 v2: "Schedule",                 transform: transformSchedule },
  { v1: "CourseSessionType",        v2: "CourseSessionType",        transform: transformCourseSessionType },

  // 5. Relations that depend on Users + Student
  { v1: "Relationship",             v2: "Relationship",             transform: transformRelationship },

  // 6. Shopping cart (depends on Users)
  { v1: "ShoppingCart",             v2: "ShoppingCart",             transform: transformShoppingCart },

  // 7. Enrollment (depends on Student + Course + SessionType + Users)
  { v1: "Enrollment",               v2: "Enrollment",               transform: transformEnrollment },

  // 8. ShoppingCartDetail (depends on ShoppingCart)
  { v1: "ShoppingCartDetail",       v2: "ShoppingCartDetail",       transform: transformShoppingCartDetail },

  // 9. PaymentTransactions (depends on ShoppingCart + Users)
  { v1: "PaymentTransactions",      v2: "PaymentTransactions",      transform: transformPaymentTransactions },

  // 10. SessionDetail (depends on Enrollment + Student + Course + Schedule)
  { v1: "SessionDetail",            v2: "SessionDetail",            transform: transformSessionDetail },

  // 11. EmailSend (depends on Enrollment + Student + Users)
  { v1: "EmailSend",                v2: "EmailSend",                transform: transformEmailSend },

  // 12. Evaluations (depend on EvaluationLevel + Student + Users)
  { v1: "StudentEvaluations",       v2: "StudentEvaluations",       transform: transformStudentEvaluations },
  { v1: "StudentEvaluationsDetail", v2: "StudentEvaluationsDetail", transform: transformStudentEvaluationsDetail },
];

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== V1 → V2 DynamoDB Migration ===\n");
  const summary = [];

  for (const step of MIGRATION_STEPS) {
    process.stdout.write(`Migrating ${step.v1} → v2${step.v2}...`);
    let items;
    try {
      items = loadBackup(step.v1);
    } catch (e) {
      console.log(` SKIP (file not found)`);
      summary.push({ model: step.v1, v1Count: 0, written: 0, status: "skipped" });
      continue;
    }

    const v1Count = items.length;
    let transformed = [];
    let transformErrors = 0;
    for (const item of items) {
      try {
        const t = step.transform(item);
        if (t && t.id) transformed.push(t);
        else transformErrors++;
      } catch (e) {
        transformErrors++;
      }
    }

    const written = await batchWrite(step.v2, transformed);
    const status = transformErrors > 0 ? `${transformErrors} transform errors` : "ok";
    console.log(` ${written}/${v1Count} written (${status})`);
    summary.push({ model: step.v1, v1Count, written, status });
  }

  console.log("\n=== Migration Summary ===\n");
  console.log(`${"Model".padEnd(32)} ${"V1 Records".padStart(12)} ${"Written".padStart(10)} Status`);
  console.log("-".repeat(72));
  let totalV1 = 0, totalWritten = 0;
  for (const r of summary) {
    console.log(
      `${r.model.padEnd(32)} ${String(r.v1Count).padStart(12)} ${String(r.written).padStart(10)}  ${r.status}`
    );
    totalV1 += r.v1Count;
    totalWritten += r.written;
  }
  console.log("-".repeat(72));
  console.log(`${"TOTAL".padEnd(32)} ${String(totalV1).padStart(12)} ${String(totalWritten).padStart(10)}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
