/**
 * migrate-to-v2.mjs
 *
 * Migra datos de backup JSON (Gen 1) a las tablas DynamoDB v2 (Amplify Gen 2).
 *
 * Uso:
 *   node scripts/migrate-to-v2.mjs [--dry-run]
 *
 * Requiere:
 *   - AWS profile "miniswimmer" configurado (~/.aws/credentials)
 *   - Node.js con @aws-sdk/client-dynamodb y @aws-sdk/lib-dynamodb disponibles
 */

import { readFileSync } from "fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const BACKUP_DIR =
  "/Users/manu/_PROYECTOS/MINI-SWIMMER/DATABASE/RESPALDO-15-Marzo-2026";
const TABLE_SUFFIX = "-ohxduisx7jaqderjzpjet5zl6y-NONE";
const AWS_REGION = "us-east-2";
const AWS_PROFILE = "miniswimmer";
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_TABLE = process.argv.find((a) => a.startsWith("--table="))?.split("=")[1];
const BATCH_SIZE = 25; // DynamoDB BatchWrite max
const BATCH_DELAY_MS = 50; // small delay between batches to avoid throttling

// ─── CLIENTE DYNAMODB ─────────────────────────────────────────────────────────

const client = new DynamoDBClient({
  region: AWS_REGION,
  credentials: fromIni({ profile: AWS_PROFILE }),
});
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function tableName(model) {
  return `${model}${TABLE_SUFFIX}`;
}

function readBackup(filename) {
  const path = `${BACKUP_DIR}/${filename}`;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function clean(obj, dropKeys = []) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (dropKeys.includes(k)) continue;
    if (v === null || v === undefined) continue; // omit nulls/undefined
    result[k] = v;
  }
  return result;
}

function rename(obj, mapping) {
  const result = { ...obj };
  for (const [oldKey, newKey] of Object.entries(mapping)) {
    if (oldKey in result) {
      result[newKey] = result[oldKey];
      delete result[oldKey];
    }
  }
  return result;
}

async function batchWrite(tableNameStr, items) {
  let written = 0;
  const errors = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    const requests = chunk.map((item) => ({ PutRequest: { Item: item } }));

    if (DRY_RUN) {
      written += chunk.length;
      continue;
    }

    let unprocessed = requests;
    let attempts = 0;

    while (unprocessed.length > 0 && attempts < 5) {
      try {
        const cmd = new BatchWriteCommand({
          RequestItems: { [tableNameStr]: unprocessed },
        });
        const resp = await docClient.send(cmd);
        const remaining =
          resp.UnprocessedItems?.[tableNameStr] ?? [];
        written += unprocessed.length - remaining.length;
        unprocessed = remaining;
        if (unprocessed.length > 0) {
          attempts++;
          await new Promise((r) => setTimeout(r, 200 * attempts));
        }
      } catch (err) {
        errors.push({ batch: i / BATCH_SIZE, error: err.message });
        break;
      }
    }

    if (unprocessed.length > 0) {
      errors.push({
        batch: i / BATCH_SIZE,
        error: `${unprocessed.length} items unprocessed after retries`,
      });
    }

    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  return { written, errors };
}

// ─── TRANSFORMADORES POR TABLA ────────────────────────────────────────────────

const transformers = {
  // ── Users ──────────────────────────────────────────────────────────────────
  "v2Users": () => {
    const data = readBackup("Users-t4pplxi6t5danh3iji6dcux5ku-prod.json");
    return data.map((r) =>
      clean(r, ["__typename", "usersRolesId"])
    );
  },

  // ── Student ─────────────────────────────────────────────────────────────────
  "v2Student": () => {
    const data = readBackup("Student-t4pplxi6t5danh3iji6dcux5ku-prod.json");
    return data.map((r) => clean(r, ["__typename"]));
  },

  // ── Location ────────────────────────────────────────────────────────────────
  "v2Location": () => {
    const data = readBackup("Location-t4pplxi6t5danh3iji6dcux5ku-prod.json");
    return data.map((r) => clean(r, ["__typename"]));
  },

  // ── Course ──────────────────────────────────────────────────────────────────
  // AgeGroupType → ageGroupType (case fix), locationCoursesId → locationId
  "v2Course": () => {
    const data = readBackup("Course-t4pplxi6t5danh3iji6dcux5ku-prod.json");
    return data.map((r) => {
      let item = clean(r, ["__typename"]);
      item = rename(item, {
        AgeGroupType: "ageGroupType",
        locationCoursesId: "locationId",
      });
      return item;
    });
  },

  // ── Schedule ────────────────────────────────────────────────────────────────
  "v2Schedule": () => {
    const data = readBackup("Schedule-t4pplxi6t5danh3iji6dcux5ku-prod.json");
    return data.map((r) => clean(r, ["__typename"]));
  },

  // ── SessionType ─────────────────────────────────────────────────────────────
  "v2SessionType": () => {
    const data = readBackup("SessionType-t4pplxi6t5danh3iji6dcux5ku-prod.json");
    return data.map((r) => clean(r, ["__typename"]));
  },

  // ── CourseSessionType ────────────────────────────────────────────────────────
  "v2CourseSessionType": () => {
    const data = readBackup(
      "CourseSessionType-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => clean(r, ["__typename"]));
  },

  // ── Enrollment ───────────────────────────────────────────────────────────────
  // studentEnrollmentsId → studentId, courseEnrollmentsId → courseId,
  // sessionTypeEnrollmentsId → sessionTypeId
  // userId (required) no existe en Gen 1: se marca como "MIGRATED"
  "v2Enrollment": () => {
    const data = readBackup("Enrollment-t4pplxi6t5danh3iji6dcux5ku-prod.json");
    return data.map((r) => {
      let item = clean(r, ["__typename"]);
      item = rename(item, {
        studentEnrollmentsId: "studentId",
        courseEnrollmentsId: "courseId",
        sessionTypeEnrollmentsId: "sessionTypeId",
      });
      if (!item.userId) item.userId = "MIGRATED";
      return item;
    });
  },

  // ── SessionDetail ────────────────────────────────────────────────────────────
  // sessionDetailStudentId → studentId, enrollmentSessionDetailsId → enrollmentId
  // DynamoDB no permite string vacío en GSI keys → reemplazar con placeholder
  "v2SessionDetail": () => {
    const data = readBackup(
      "SessionDetail-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => {
      let item = clean(r, ["__typename"]);
      item = rename(item, {
        sessionDetailStudentId: "studentId",
        enrollmentSessionDetailsId: "enrollmentId",
      });
      // GSI keys no pueden ser string vacío en DynamoDB
      if (!item.scheduleId) item.scheduleId = "SIN-SCHEDULE";
      if (!item.courseId) item.courseId = "SIN-CURSO";
      if (!item.locationId) item.locationId = "SIN-LOCATION";
      if (!item.locationIdUsed) item.locationIdUsed = "SIN-LOCATION";
      return item;
    });
  },

  // ── Relationship ─────────────────────────────────────────────────────────────
  // usersRelationshipsId → userId, studentRelationshipsId → studentId
  "v2Relationship": () => {
    const data = readBackup(
      "Relationship-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => {
      let item = clean(r, ["__typename"]);
      item = rename(item, {
        usersRelationshipsId: "userId",
        studentRelationshipsId: "studentId",
      });
      return item;
    });
  },

  // ── ShoppingCart ─────────────────────────────────────────────────────────────
  // usersShoppingCartId → userId
  // sellerId (required) no existe en Gen 1: se marca como "MIGRATED"
  "v2ShoppingCart": () => {
    const data = readBackup(
      "ShoppingCart-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => {
      let item = clean(r, ["__typename"]);
      item = rename(item, { usersShoppingCartId: "userId" });
      if (!item.sellerId) item.sellerId = "MIGRATED";
      return item;
    });
  },

  // ── ShoppingCartDetail ───────────────────────────────────────────────────────
  // shoppingCartCartDetailsId → cartId
  "v2ShoppingCartDetail": () => {
    const data = readBackup(
      "ShoppingCartDetail-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => {
      let item = clean(r, ["__typename"]);
      item = rename(item, { shoppingCartCartDetailsId: "cartId" });
      return item;
    });
  },

  // ── PaymentTransactions ──────────────────────────────────────────────────────
  // usersPaymentTransactionsId → usersId
  // shoppingCartPaymentTransactionsId → shoppingCartId
  // "day#month#year#hour" es una GSI key compuesta de Gen 1, se elimina
  "v2PaymentTransactions": () => {
    const data = readBackup(
      "PaymentTransactions-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => {
      let item = clean(r, ["__typename", "day#month#year#hour"]);
      item = rename(item, {
        usersPaymentTransactionsId: "usersId",
        shoppingCartPaymentTransactionsId: "shoppingCartId",
      });
      // Asegurar que campos numéricos sean strings si el schema los define como string
      if (item.installments_number !== undefined)
        item.installments_number = String(item.installments_number);
      if (item.installments_amount !== undefined)
        item.installments_amount = String(item.installments_amount);
      if (item.response_code !== undefined)
        item.response_code = String(item.response_code);
      return item;
    });
  },

  // ── ParametersEnc ────────────────────────────────────────────────────────────
  "v2ParametersEnc": () => {
    const data = readBackup(
      "ParametersEnc-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => clean(r, ["__typename"]));
  },

  // ── Parameters ───────────────────────────────────────────────────────────────
  // parametersEncTypeOfParameterId → typeOfParameterId
  // country no existe en Gen 1: se agrega "CHILE"
  "v2Parameters": () => {
    const data = readBackup(
      "Parameters-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => {
      let item = clean(r, ["__typename"]);
      item = rename(item, {
        parametersEncTypeOfParameterId: "typeOfParameterId",
      });
      if (!item.country) item.country = "CHILE";
      return item;
    });
  },

  // ── AcademyStudents ──────────────────────────────────────────────────────────
  "v2AcademyStudents": () => {
    const data = readBackup(
      "AcademyStudents-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => clean(r, ["__typename"]));
  },

  // ── Correlatives ─────────────────────────────────────────────────────────────
  "v2Correlatives": () => {
    const data = readBackup(
      "Correlatives-t4pplxi6t5danh3iji6dcux5ku-prod.json"
    );
    return data.map((r) => clean(r, ["__typename"]));
  },
};

// ─── EJECUCIÓN ────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║     MIGRACIÓN Gen 1 → v2 DynamoDB               ║");
  console.log(`║     Modo: ${DRY_RUN ? "DRY-RUN (sin escritura)" : "PRODUCCIÓN ⚠️ "}         ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  const summary = [];
  const startTime = Date.now();

  const entries = ONLY_TABLE
    ? Object.entries(transformers).filter(([m]) => m === ONLY_TABLE)
    : Object.entries(transformers);

  for (const [model, transform] of entries) {
    const table = tableName(model);
    process.stdout.write(`⏳ ${model.padEnd(30)} → `);

    let items, result;
    try {
      items = transform();
      result = await batchWrite(table, items);
    } catch (err) {
      console.log(`❌ ERROR: ${err.message}`);
      summary.push({
        model,
        total: 0,
        written: 0,
        errors: [err.message],
      });
      continue;
    }

    const status = result.errors.length === 0 ? "✅" : "⚠️ ";
    console.log(
      `${status} ${result.written}/${items.length} escritos${
        result.errors.length > 0 ? `  (${result.errors.length} errores)` : ""
      }`
    );

    if (result.errors.length > 0) {
      result.errors.forEach((e) =>
        console.log(`     └─ Batch ${e.batch}: ${e.error}`)
      );
    }

    summary.push({
      model,
      table,
      total: items.length,
      written: result.written,
      errors: result.errors,
    });
  }

  // ─── RESUMEN FINAL ──────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalRecords = summary.reduce((s, r) => s + r.total, 0);
  const totalWritten = summary.reduce((s, r) => s + r.written, 0);
  const totalErrors = summary.reduce((s, r) => s + r.errors.length, 0);

  console.log("\n══════════════════════════════════════════════════");
  console.log("  RESUMEN DE MIGRACIÓN");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Tablas migradas : ${summary.length}`);
  console.log(`  Total registros : ${totalRecords.toLocaleString()}`);
  console.log(`  Total escritos  : ${totalWritten.toLocaleString()}`);
  console.log(
    `  Total errores   : ${totalErrors === 0 ? "0 ✅" : totalErrors + " ⚠️ "}`
  );
  console.log(`  Tiempo total    : ${elapsed}s`);
  console.log(`  Modo            : ${DRY_RUN ? "DRY-RUN" : "ESCRITURA REAL"}`);
  console.log("══════════════════════════════════════════════════");

  console.log("\n  Detalle por tabla:");
  console.log(
    `  ${"Modelo".padEnd(30)} ${"Total".padStart(7)} ${"Escritos".padStart(9)} ${"Errores".padStart(8)}`
  );
  console.log("  " + "─".repeat(60));
  for (const r of summary) {
    const status = r.errors.length === 0 ? " " : "⚠";
    console.log(
      `${status} ${r.model.padEnd(30)} ${String(r.total).padStart(7)} ${String(
        r.written
      ).padStart(9)} ${String(r.errors.length).padStart(8)}`
    );
  }
  console.log("");

  if (totalErrors > 0) {
    console.log("  Notas:");
    console.log(
      "  - Revisa los errores arriba y ejecuta de nuevo si hay throttling."
    );
  }

  if (!DRY_RUN) {
    console.log("\n  ⚠️  Campos con valores MIGRATED (requieren revisión):");
    console.log("  - v2Enrollment.userId        → origen Gen 1 no tenía este campo");
    console.log("  - v2ShoppingCart.sellerId    → origen Gen 1 no tenía este campo");
    console.log("");
  }
}

main().catch((err) => {
  console.error("\n❌ Error fatal:", err.message);
  process.exit(1);
});
