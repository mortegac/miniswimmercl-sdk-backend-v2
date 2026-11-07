/**
 * backup-dynamodb-full.mjs
 *
 * Respalda TODAS las tablas DynamoDB con el sufijo especificado.
 * Lee directo de DynamoDB (scan completo con paginación).
 * Guarda cada tabla como JSON en BASE-DATOS/dynamodb/{TableName}.json
 *
 * Uso:
 *   node scripts/backup-dynamodb-full.mjs
 *   node scripts/backup-dynamodb-full.mjs --suffix ggfytzhgxvd3pcnyj2mjkfenre-NONE
 */

import { DynamoDBClient, ListTablesCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGION   = "us-east-2";
const PROFILE  = "MINISWIMMER-05FEB2026";

// Sufijo de las tablas a respaldar (puede sobreescribirse con --suffix)
const suffixArg = process.argv.find((a) => a.startsWith("--suffix="))?.split("=")[1]
  ?? (process.argv.indexOf("--suffix") !== -1
      ? process.argv[process.argv.indexOf("--suffix") + 1]
      : "ggfytzhgxvd3pcnyj2mjkfenre-NONE");

const BACKUP_DIR = join(__dirname, "BASE-DATOS", "dynamodb");

// ─── CLIENTE ─────────────────────────────────────────────────────────────────

const raw = new DynamoDBClient({
  region: REGION,
  credentials: fromIni({ profile: PROFILE }),
});
const dynamo = DynamoDBDocumentClient.from(raw, {
  marshallOptions:   { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Lista todas las tablas que contengan el sufijo dado */
async function listMatchingTables(suffix) {
  const tables = [];
  let lastEvaluatedTableName;
  do {
    const cmd = new ListTablesCommand({
      ExclusiveStartTableName: lastEvaluatedTableName,
      Limit: 100,
    });
    const res = await raw.send(cmd);
    tables.push(...res.TableNames.filter((t) => t.includes(suffix)));
    lastEvaluatedTableName = res.LastEvaluatedTableName;
  } while (lastEvaluatedTableName);
  return tables.sort();
}

/** Scan completo de una tabla con paginación */
async function scanAll(tableName) {
  const items = [];
  let lastKey;
  do {
    const cmd = new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastKey,
    });
    const res = await raw.send(cmd);
    // unmarshall convierte el formato DynamoDB {S:"val"} → "val"
    items.push(...(res.Items || []).map((i) => unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log("═".repeat(65));
  console.log("  BACKUP COMPLETO DynamoDB");
  console.log(`  Fecha:  ${new Date().toISOString()}`);
  console.log(`  Sufijo: ${suffixArg}`);
  console.log(`  Destino: ${BACKUP_DIR}`);
  console.log("═".repeat(65));

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  // 1. Listar tablas
  process.stdout.write("\n🔍 Listando tablas...");
  const tables = await listMatchingTables(suffixArg);
  console.log(` ${tables.length} encontradas\n`);

  if (tables.length === 0) {
    console.log("⚠️  No se encontraron tablas con ese sufijo.");
    return;
  }

  // 2. Respaldar cada tabla
  const results = [];
  for (const tableName of tables) {
    process.stdout.write(`  📦 ${tableName.replace(`-${suffixArg}`, "")}...`);
    try {
      const items = await scanAll(tableName);
      const file  = join(BACKUP_DIR, `${tableName}.json`);
      writeFileSync(file, JSON.stringify(items, null, 2), "utf-8");
      process.stdout.write(` ${items.length} registros ✓\n`);
      results.push({ table: tableName, count: items.length, error: null });
    } catch (err) {
      process.stdout.write(` ❌ ERROR: ${err.message}\n`);
      results.push({ table: tableName, count: 0, error: err.message });
    }
  }

  // 3. Resumen
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalRecords = results.reduce((s, r) => s + r.count, 0);
  const errors       = results.filter((r) => r.error);

  console.log("\n" + "═".repeat(65));
  console.log("  RESUMEN");
  console.log("═".repeat(65));
  console.log(`${"Tabla".padEnd(45)} ${"Registros".padStart(10)}`);
  console.log("─".repeat(65));
  for (const r of results) {
    const name = r.table.replace(`-${suffixArg}`, "").padEnd(45);
    const count = r.error ? "ERROR".padStart(10) : String(r.count).padStart(10);
    console.log(`${name} ${count}`);
  }
  console.log("─".repeat(65));
  console.log(`${"TOTAL".padEnd(45)} ${String(totalRecords).padStart(10)}`);
  console.log("═".repeat(65));
  console.log(`\n💾 Archivos guardados en: ${BACKUP_DIR}`);
  console.log(`⏱  Tiempo: ${elapsed}s`);

  if (errors.length > 0) {
    console.log(`\n⚠️  ${errors.length} errores:`);
    errors.forEach((e) => console.log(`   - ${e.table}: ${e.error}`));
    process.exit(1);
  } else {
    console.log(`✅  Backup completado sin errores (${tables.length} tablas, ${totalRecords} registros)\n`);
  }
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err);
  process.exit(1);
});
