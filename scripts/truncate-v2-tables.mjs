/**
 * truncate-v2-tables.mjs
 *
 * Elimina TODOS los registros de las tablas con prefijo "v2" en DynamoDB.
 * Usa DescribeTable para obtener el KeySchema de cada tabla (soporta
 * hash-only y hash+range), luego elimina en lotes de 25 (límite AWS).
 *
 * ⚠️  DESTRUCTIVO — ejecutar solo con backup previo.
 *
 * Uso:
 *   node scripts/truncate-v2-tables.mjs
 *   node scripts/truncate-v2-tables.mjs --dry-run      (sin borrar, solo cuenta)
 *   node scripts/truncate-v2-tables.mjs --table v2Users (solo una tabla)
 *
 * Salida:
 *   scripts/BASE-DATOS/truncate-logs/{timestamp}/RESUMEN.md
 */

import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  ScanCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGION    = "us-east-2";
const PROFILE   = "MINISWIMMER-05FEB2026";
const V2_SUFFIX = "u5x5i3ucwvc43j4peic26jnrlq-NONE";
const BATCH_SIZE = 25; // límite BatchWriteItem de AWS

const DRY_RUN = process.argv.includes("--dry-run");
const onlyTable = process.argv.find((a) => a.startsWith("--table="))?.split("=")[1]
  ?? (process.argv.indexOf("--table") !== -1
      ? process.argv[process.argv.indexOf("--table") + 1]
      : null);

const TS = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const LOG_DIR = join(__dirname, "BASE-DATOS", "truncate-logs", TS);

// ─── CLIENTE ─────────────────────────────────────────────────────────────────

const client = new DynamoDBClient({
  region: REGION,
  credentials: fromIni({ profile: PROFILE }),
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function listV2Tables() {
  const all = [];
  let lastKey;
  do {
    const res = await client.send(
      new ListTablesCommand({ ExclusiveStartTableName: lastKey, Limit: 100 })
    );
    all.push(...res.TableNames.filter((t) => t.startsWith("v2")));
    lastKey = res.LastEvaluatedTableName;
  } while (lastKey);
  return all.sort();
}

/** Devuelve los atributos que forman la PK: [{name, type}] */
async function getKeySchema(tableName) {
  const res = await client.send(new DescribeTableCommand({ TableName: tableName }));
  return res.Table.KeySchema.map((k) => k.AttributeName);
}

/** Scan completo — devuelve items en formato DynamoDB nativo (para BatchWrite) */
async function scanAllRaw(tableName) {
  const items = [];
  let lastKey;
  do {
    const res = await client.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** Extrae solo los campos de PK de un item (en formato DynamoDB nativo) */
function extractKey(item, keyAttrs) {
  return Object.fromEntries(keyAttrs.map((attr) => [attr, item[attr]]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Elimina en lotes de 25 con backoff exponencial para throttling */
async function batchDelete(tableName, keys) {
  let pending = keys;
  let deletedCount = 0;
  while (pending.length > 0) {
    const batch = pending.slice(0, BATCH_SIZE);
    pending = pending.slice(BATCH_SIZE);
    const req = {
      RequestItems: {
        [tableName]: batch.map((key) => ({ DeleteRequest: { Key: key } })),
      },
    };
    let attempt = 0;
    let res;
    // Backoff para throttling
    while (true) {
      try {
        res = await client.send(new BatchWriteItemCommand(req));
        break;
      } catch (err) {
        if (err.name === "ProvisionedThroughputExceededException" && attempt < 8) {
          const wait = Math.min(1000 * 2 ** attempt, 30000);
          process.stdout.write(` [throttle, retry ${attempt + 1}, wait ${wait}ms]`);
          await sleep(wait);
          attempt++;
        } else {
          throw err;
        }
      }
    }
    deletedCount += batch.length;
    // Reintentar unprocessed items con backoff
    let unprocessed = res.UnprocessedItems ?? {};
    let retries = 0;
    while (Object.keys(unprocessed).length > 0) {
      const wait = Math.min(500 * 2 ** retries, 15000);
      await sleep(wait);
      res = await client.send(new BatchWriteItemCommand({ RequestItems: unprocessed }));
      unprocessed = res.UnprocessedItems ?? {};
      retries++;
    }
    // Pausa pequeña entre lotes para evitar throttling en tablas grandes
    if (pending.length > 0) await sleep(100);
  }
  return deletedCount;
}

// ─── MARKDOWN ────────────────────────────────────────────────────────────────

function buildMarkdown({ startISO, endISO, elapsedSec, results, dryRun }) {
  const ok     = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const totalDeleted = ok.reduce((s, r) => s + r.deleted, 0);

  const lines = [];
  lines.push(`# Truncate v2 Tables — Informe`);
  lines.push(``);
  lines.push(`> **Modo:** ${dryRun ? "🟡 DRY RUN (sin cambios reales)" : "🔴 EJECUCIÓN REAL — registros eliminados"}`);
  lines.push(``);
  lines.push(`| Campo | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Inicio | \`${startISO}\` |`);
  lines.push(`| Fin | \`${endISO}\` |`);
  lines.push(`| Duración | ${elapsedSec}s |`);
  lines.push(`| Región | \`${REGION}\` |`);
  lines.push(`| Perfil AWS | \`${PROFILE}\` |`);
  lines.push(``);
  lines.push(`## Resumen Ejecutivo`);
  lines.push(``);
  lines.push(`| Métrica | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| Tablas procesadas | **${results.length}** |`);
  lines.push(`| Tablas OK | **${ok.length}** |`);
  lines.push(`| Tablas con error | **${failed.length}** |`);
  lines.push(`| Total registros ${dryRun ? "encontrados" : "eliminados"} | **${totalDeleted.toLocaleString()}** |`);
  lines.push(``);
  lines.push(`## Detalle por Tabla`);
  lines.push(``);
  lines.push(`| Tabla | Registros | Estado |`);
  lines.push(`|---|---|---|`);
  for (const r of results) {
    const status = r.error
      ? `❌ \`${r.error}\``
      : r.deleted === 0
        ? "⬜ Vacía"
        : dryRun
          ? `🟡 ${r.deleted.toLocaleString()} (dry-run)`
          : `✅ ${r.deleted.toLocaleString()} eliminados`;
    lines.push(`| \`${r.table}\` | ${r.deleted.toLocaleString()} | ${status} |`);
  }
  lines.push(``);

  if (failed.length > 0) {
    lines.push(`## ⚠️ Errores`);
    lines.push(``);
    lines.push(`| Tabla | Error |`);
    lines.push(`|---|---|`);
    for (const r of failed) {
      lines.push(`| \`${r.table}\` | ${r.error} |`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const startISO  = new Date().toISOString();

  console.log("═".repeat(70));
  console.log("  TRUNCATE v2 Tables — ELIMINACIÓN DE REGISTROS");
  console.log(`  Modo:    ${DRY_RUN ? "🟡 DRY RUN" : "🔴 REAL"}`);
  console.log(`  Inicio:  ${startISO}`);
  if (onlyTable) console.log(`  Tabla:   ${onlyTable}`);
  console.log("═".repeat(70));

  if (!DRY_RUN) {
    console.log("\n⚠️  ATENCIÓN: Esta operación eliminará registros de forma permanente.");
    console.log("   Continúa en 5 segundos... (Ctrl+C para cancelar)\n");
    await new Promise((r) => setTimeout(r, 5000));
  }

  mkdirSync(LOG_DIR, { recursive: true });

  // 1. Listar tablas v2
  process.stdout.write("\n🔍 Listando tablas v2...");
  let tables = await listV2Tables();
  if (onlyTable) {
    tables = tables.filter((t) => t.startsWith(onlyTable));
  }
  console.log(` ${tables.length} encontradas\n`);

  // 2. Procesar cada tabla
  const results = [];
  for (const tableName of tables) {
    process.stdout.write(`  🗑  ${tableName.replace(`-${V2_SUFFIX}`, "")}...`);
    try {
      const keyAttrs = await getKeySchema(tableName);
      const items    = await scanAllRaw(tableName);

      if (items.length === 0) {
        process.stdout.write(` vacía ✓\n`);
        results.push({ table: tableName, deleted: 0, error: null });
        continue;
      }

      if (DRY_RUN) {
        process.stdout.write(` ${items.length} registros (dry-run) 🟡\n`);
        results.push({ table: tableName, deleted: items.length, error: null });
        continue;
      }

      const keys    = items.map((item) => extractKey(item, keyAttrs));
      const deleted = await batchDelete(tableName, keys);
      process.stdout.write(` ${deleted} eliminados ✅\n`);
      results.push({ table: tableName, deleted, error: null });
    } catch (err) {
      process.stdout.write(` ❌ ${err.message}\n`);
      results.push({ table: tableName, deleted: 0, error: err.message });
    }
  }

  // 3. Generar RESUMEN.md
  const endISO     = new Date().toISOString();
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const md = buildMarkdown({ startISO, endISO, elapsedSec, results, dryRun: DRY_RUN });
  const mdPath = join(LOG_DIR, "RESUMEN.md");
  writeFileSync(mdPath, md, "utf-8");

  // 4. Consola — resumen
  const ok      = results.filter((r) => !r.error);
  const failed  = results.filter((r) => r.error);
  const total   = ok.reduce((s, r) => s + r.deleted, 0);

  console.log("\n" + "═".repeat(70));
  console.log(`  ${DRY_RUN ? "🟡 DRY RUN" : "✅ COMPLETADO"}`);
  console.log(`  ${ok.length} tablas OK  |  ❌ ${failed.length} errores  |  ${total.toLocaleString()} registros ${DRY_RUN ? "encontrados" : "eliminados"}`);
  console.log(`  ⏱   ${elapsedSec}s`);
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
