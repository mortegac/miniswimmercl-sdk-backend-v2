/**
 * backup-all-tables.mjs
 *
 * Respalda TODAS las tablas DynamoDB de la cuenta (sin filtro de sufijo).
 * Incluye tablas con prefijo v2*, sin prefijo, y cualquier otra.
 *
 * Uso:
 *   node scripts/backup-all-tables.mjs
 *   node scripts/backup-all-tables.mjs --out ./mi-backup
 *
 * Salida:
 *   BASE-DATOS/backup-all/{timestamp}/
 *     ├── {TableName}.json      (datos de cada tabla)
 *     └── RESUMEN.md            (informe completo del backup)
 */

import {
  DynamoDBClient,
  ListTablesCommand,
  ScanCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGION    = "us-east-2";
const PROFILE   = "MINISWIMMER-05FEB2026";

const outArg = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1]
  ?? (process.argv.indexOf("--out") !== -1
      ? process.argv[process.argv.indexOf("--out") + 1]
      : null);

// Timestamp para el directorio de este backup
const TS = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const BACKUP_DIR = outArg
  ? join(outArg, TS)
  : join(__dirname, "BASE-DATOS", "backup-all", TS);

// ─── CLIENTE ─────────────────────────────────────────────────────────────────

const raw = new DynamoDBClient({
  region: REGION,
  credentials: fromIni({ profile: PROFILE }),
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Lista TODAS las tablas de la cuenta (paginado) */
async function listAllTables() {
  const tables = [];
  let lastKey;
  do {
    const res = await raw.send(
      new ListTablesCommand({ ExclusiveStartTableName: lastKey, Limit: 100 })
    );
    tables.push(...res.TableNames);
    lastKey = res.LastEvaluatedTableName;
  } while (lastKey);
  return tables.sort();
}

/** Describe una tabla (para obtener itemCount aproximado y estado) */
async function describeTable(tableName) {
  try {
    const res = await raw.send(new DescribeTableCommand({ TableName: tableName }));
    return res.Table;
  } catch {
    return null;
  }
}

/** Scan completo con paginación — devuelve items ya unmarshalled */
async function scanAll(tableName) {
  const items = [];
  let lastKey;
  do {
    const res = await raw.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey })
    );
    items.push(...(res.Items ?? []).map((i) => unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** Clasifica una tabla por prefijo para el resumen */
function classify(name) {
  if (/^v2/.test(name)) return "v2 (nuevo)";
  if (/^amplify-/.test(name)) return "amplify-*";
  return "sin prefijo / otro";
}

/** Formatea bytes a KB/MB */
function fmtBytes(b) {
  if (b == null) return "N/A";
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(2)} MB`;
}

/** Genera el archivo RESUMEN.md */
function buildMarkdown({ startISO, endISO, elapsedSec, tables, results }) {
  const ok     = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const totalRecords = ok.reduce((s, r) => s + r.count, 0);

  // Agrupar por clasificación
  const byClass = {};
  for (const r of results) {
    const c = classify(r.table);
    byClass[c] ??= [];
    byClass[c].push(r);
  }

  const lines = [];

  lines.push(`# Backup DynamoDB — Informe Completo`);
  lines.push(``);
  lines.push(`| Campo | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Inicio | \`${startISO}\` |`);
  lines.push(`| Fin | \`${endISO}\` |`);
  lines.push(`| Duración | ${elapsedSec}s |`);
  lines.push(`| Región | \`${REGION}\` |`);
  lines.push(`| Perfil AWS | \`${PROFILE}\` |`);
  lines.push(`| Directorio backup | \`${BACKUP_DIR}\` |`);
  lines.push(``);
  lines.push(`## Resumen Ejecutivo`);
  lines.push(``);
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Total tablas encontradas | **${tables.length}** |`);
  lines.push(`| Tablas respaldadas OK | **${ok.length}** |`);
  lines.push(`| Tablas con error | **${failed.length}** |`);
  lines.push(`| Total registros respaldados | **${totalRecords.toLocaleString()}** |`);
  lines.push(``);

  // Por grupo
  lines.push(`## Tablas por Categoría`);
  lines.push(``);
  for (const [cls, items] of Object.entries(byClass)) {
    const clsOk     = items.filter((r) => !r.error);
    const clsTotal  = clsOk.reduce((s, r) => s + r.count, 0);
    lines.push(`### ${cls}`);
    lines.push(``);
    lines.push(`| Tabla | Registros | Tamaño aprox. | Estado |`);
    lines.push(`|---|---|---|---|`);
    for (const r of items) {
      const status = r.error ? `❌ \`${r.error}\`` : "✅ OK";
      lines.push(`| \`${r.table}\` | ${r.error ? "—" : r.count.toLocaleString()} | ${fmtBytes(r.sizeBytes)} | ${status} |`);
    }
    lines.push(``);
    lines.push(`**Subtotal ${cls}:** ${clsOk.length} tablas, ${clsTotal.toLocaleString()} registros`);
    lines.push(``);
  }

  // Errores detallados
  if (failed.length > 0) {
    lines.push(`## ⚠️ Errores — Tablas NO Respaldadas`);
    lines.push(``);
    lines.push(`> Estas tablas deben revisarse manualmente.`);
    lines.push(``);
    lines.push(`| Tabla | Error |`);
    lines.push(`|---|---|`);
    for (const r of failed) {
      lines.push(`| \`${r.table}\` | ${r.error} |`);
    }
    lines.push(``);
  } else {
    lines.push(`## ✅ Sin Errores`);
    lines.push(``);
    lines.push(`Todas las tablas fueron respaldadas exitosamente.`);
    lines.push(``);
  }

  // Tablas vacías (advertencia, no error)
  const empty = ok.filter((r) => r.count === 0);
  if (empty.length > 0) {
    lines.push(`## ℹ️ Tablas Vacías (0 registros)`);
    lines.push(``);
    lines.push(`| Tabla |`);
    lines.push(`|---|`);
    for (const r of empty) lines.push(`| \`${r.table}\` |`);
    lines.push(``);
  }

  // Lista completa
  lines.push(`## Lista Completa de Tablas`);
  lines.push(``);
  lines.push(`| # | Tabla | Registros | Tamaño | Estado |`);
  lines.push(`|---|---|---|---|---|`);
  results.forEach((r, i) => {
    const status = r.error ? "❌" : "✅";
    const count  = r.error ? "—" : r.count.toLocaleString();
    lines.push(`| ${i + 1} | \`${r.table}\` | ${count} | ${fmtBytes(r.sizeBytes)} | ${status} |`);
  });
  lines.push(``);

  return lines.join("\n");
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const startISO  = new Date().toISOString();

  console.log("═".repeat(70));
  console.log("  BACKUP COMPLETO DynamoDB — TODAS LAS TABLAS");
  console.log(`  Inicio:  ${startISO}`);
  console.log(`  Destino: ${BACKUP_DIR}`);
  console.log("═".repeat(70));

  mkdirSync(BACKUP_DIR, { recursive: true });

  // 1. Listar todas las tablas
  process.stdout.write("\n🔍 Listando tablas...");
  const tables = await listAllTables();
  console.log(` ${tables.length} encontradas\n`);

  if (tables.length === 0) {
    console.log("⚠️  No se encontraron tablas en la cuenta/región.");
    return;
  }

  // 2. Describir + Respaldar cada tabla
  const results = [];
  for (const tableName of tables) {
    process.stdout.write(`  📦 ${tableName}...`);
    const meta = await describeTable(tableName);
    try {
      const items = await scanAll(tableName);
      writeFileSync(
        join(BACKUP_DIR, `${tableName}.json`),
        JSON.stringify(items, null, 2),
        "utf-8"
      );
      process.stdout.write(` ${items.length} registros ✓\n`);
      results.push({
        table:     tableName,
        count:     items.length,
        sizeBytes: meta?.TableSizeBytes ?? null,
        error:     null,
      });
    } catch (err) {
      process.stdout.write(` ❌ ${err.message}\n`);
      results.push({
        table:     tableName,
        count:     0,
        sizeBytes: meta?.TableSizeBytes ?? null,
        error:     err.message,
      });
    }
  }

  // 3. Generar RESUMEN.md
  const endISO    = new Date().toISOString();
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  const md = buildMarkdown({ startISO, endISO, elapsedSec, tables, results });
  const mdPath = join(BACKUP_DIR, "RESUMEN.md");
  writeFileSync(mdPath, md, "utf-8");

  // 4. Consola — resumen rápido
  const ok      = results.filter((r) => !r.error);
  const failed  = results.filter((r) => r.error);
  const total   = ok.reduce((s, r) => s + r.count, 0);

  console.log("\n" + "═".repeat(70));
  console.log(`  ✅  ${ok.length} tablas respaldadas  |  ❌ ${failed.length} errores  |  📄 ${total.toLocaleString()} registros`);
  console.log(`  ⏱   ${elapsedSec}s`);
  console.log(`  📁  ${BACKUP_DIR}`);
  console.log(`  📋  ${mdPath}`);
  console.log("═".repeat(70) + "\n");

  if (failed.length > 0) {
    console.log("⚠️  Tablas con error:");
    failed.forEach((r) => console.log(`   - ${r.table}: ${r.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n💥 Error fatal:", err);
  process.exit(1);
});
