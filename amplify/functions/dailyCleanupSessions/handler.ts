import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME      = process.env.SESSION_DETAIL_TABLE!;
const STUDENT_TABLE   = process.env.STUDENT_TABLE!;
const LOCATION_TABLE  = process.env.LOCATION_TABLE!;
const COURSE_TABLE    = process.env.COURSE_TABLE!;
const SCHEDULE_TABLE  = process.env.SCHEDULE_TABLE!;
const SANTIAGO_TZ    = "America/Santiago";

// ── EmailJS config (inyectado como env vars desde backend.ts) ─────────────────
const EMAILJS_SERVICE_ID   = process.env.EMAILJS_SERVICE_ID!;
const EMAILJS_TEMPLATE_ID  = process.env.EMAILJS_TEMPLATE_ID!;
const EMAILJS_USER_ID      = process.env.EMAILJS_USER_ID!;
const EMAILJS_ACCESS_TOKEN = process.env.EMAILJS_ACCESS_TOKEN!;
const EMAILJS_API_URL      = "https://api.emailjs.com/api/v1.0/email/send";

const REPORT_RECIPIENTS = ["hi@manuelo.dev", "hola@miniswimmer.cl"];

interface SessionRow {
  id: string;
  date: string;
  studentId: string;
  locationId: string;
  courseId: string;
  scheduleId: string;
  sessionNumber: number | undefined;
  totalSessions: number | undefined;
}

interface ScheduleInfo {
  day: string;
  startHour: string;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el rango UTC exacto para "ayer" en Santiago de Chile.
 * Maneja DST automáticamente (verano UTC-3, invierno UTC-4).
 */
function getYesterdayUTCRange(): { start: string; end: string; dateStr: string } {
  const now = new Date();

  const todayStrSantiago = new Intl.DateTimeFormat("en-CA", {
    timeZone: SANTIAGO_TZ,
  }).format(now);

  const [y, m, d] = todayStrSantiago.split("-").map(Number);
  const yesterdayRef = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
  const yesterdayStrSantiago = new Intl.DateTimeFormat("en-CA", {
    timeZone: SANTIAGO_TZ,
  }).format(yesterdayRef);

  function santiagMidnightToUTC(dateStr: string): Date {
    const noonUTC = new Date(`${dateStr}T12:00:00.000Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SANTIAGO_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(noonUTC);
    const santiagHour   = Number(parts.find((p) => p.type === "hour")!.value);
    const santiagMinute = Number(parts.find((p) => p.type === "minute")!.value);
    const offsetMinutes = 12 * 60 - (santiagHour * 60 + santiagMinute);
    const midnightLocal = new Date(`${dateStr}T00:00:00.000Z`);
    return new Date(midnightLocal.getTime() + offsetMinutes * 60 * 1000);
  }

  return {
    start:   santiagMidnightToUTC(yesterdayStrSantiago).toISOString(),
    end:     santiagMidnightToUTC(todayStrSantiago).toISOString(),
    dateStr: yesterdayStrSantiago,
  };
}

async function updateToDeleted(id: string): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: "SET #status = :deleted, updatedAt = :now, modifiedByDate = :now, modifiedBy = :sistema",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":deleted":  "DELETED",
        ":now":      now,
        ":sistema":  "SISTEMA",
      },
    })
  );
}

/** Batch get nombres de estudiantes. Retorna Map<studentId, fullName>. */
async function batchGetStudents(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [STUDENT_TABLE]: {
          Keys: chunk.map((id) => ({ id })),
          ProjectionExpression: "id, #n, lastName",
          ExpressionAttributeNames: { "#n": "name" },
        },
      },
    }));
    for (const item of res.Responses?.[STUDENT_TABLE] ?? []) {
      result.set(item.id as string, `${item.name ?? ""} ${item.lastName ?? ""}`.trim());
    }
  }
  return result;
}

/** Batch get títulos de cursos. Retorna Map<courseId, title>. */
async function batchGetCourses(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return result;
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [COURSE_TABLE]: {
          Keys: chunk.map((id) => ({ id })),
          ProjectionExpression: "id, title",
        },
      },
    }));
    for (const item of res.Responses?.[COURSE_TABLE] ?? []) {
      result.set(item.id as string, (item.title as string) ?? "—");
    }
  }
  return result;
}

/** Batch get nombres de locations. Retorna Map<locationId, locationName>. */
async function batchGetLocations(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return result;
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [LOCATION_TABLE]: {
          Keys: chunk.map((id) => ({ id })),
          ProjectionExpression: "id, #n",
          ExpressionAttributeNames: { "#n": "name" },
        },
      },
    }));
    for (const item of res.Responses?.[LOCATION_TABLE] ?? []) {
      result.set(item.id as string, (item.name as string) ?? "—");
    }
  }
  return result;
}

/** Batch get day + startHour de v2Schedule. Retorna Map<scheduleId, ScheduleInfo>. */
async function batchGetSchedules(ids: string[]): Promise<Map<string, ScheduleInfo>> {
  const result = new Map<string, ScheduleInfo>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return result;
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [SCHEDULE_TABLE]: {
          Keys: chunk.map((id) => ({ id })),
        },
      },
    }));
    for (const item of res.Responses?.[SCHEDULE_TABLE] ?? []) {
      result.set(item.id as string, {
        day:       (item.day as string) ?? "—",
        startHour: (item.startHour as string) ?? "—",
      });
    }
  }
  return result;
}

/** Formatea un ISO datetime a hora Santiago (HH:mm). */
function formatTimeSantiago(isoDate: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: SANTIAGO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoDate));
}

/**
 * Envía un email de reporte a un destinatario via EmailJS REST API.
 */
async function sendReportEmail(
  toEmail: string,
  dateStr: string,
  totalUpdated: number,
  startUTC: string,
  endUTC: string,
  sessions: SessionRow[],
  studentNames: Map<string, string>,
  locationNames: Map<string, string>,
  courseNames: Map<string, string>,
  scheduleInfos: Map<string, ScheduleInfo>,
): Promise<void> {
  const mensaje = totalUpdated === 0
    ? `No se encontraron sesiones activas para el ${dateStr}.`
    : `Se actualizaron ${totalUpdated} sesión(es) a estado DELETED correspondientes al ${dateStr} (hora Santiago).`;

  const sessionRows = sessions.map((s, idx) => {
    const bg       = idx % 2 === 0 ? "#ffffff" : "#f7f9ff";
    const schedule = scheduleInfos.get(s.scheduleId);
    const hora     = schedule ? `${schedule.day} ${schedule.startHour}` : formatTimeSantiago(s.date);
    const alumno   = studentNames.get(s.studentId) ?? s.studentId;
    const loc     = locationNames.get(s.locationId) ?? s.locationId ?? "—";
    const curso   = courseNames.get(s.courseId) ?? s.courseId ?? "—";
    const sesion  = s.sessionNumber != null && s.totalSessions != null
      ? `${s.sessionNumber} / ${s.totalSessions}`
      : s.sessionNumber != null ? String(s.sessionNumber) : "—";
    return `
      <tr style="background:${bg};">
        <td style="border:1px solid #dde3f0;padding:8px 10px;">${idx + 1}</td>
        <td style="border:1px solid #dde3f0;padding:8px 10px;">${alumno}</td>
        <td style="border:1px solid #dde3f0;padding:8px 10px;">${loc}</td>
        <td style="border:1px solid #dde3f0;padding:8px 10px;">${curso}</td>
        <td style="border:1px solid #dde3f0;padding:8px 10px;">${hora}</td>
        <td style="border:1px solid #dde3f0;padding:8px 10px;text-align:center;">${sesion}</td>
      </tr>`;
  }).join("");

  const sessionTable = sessions.length > 0 ? `
    <h3 style="font-size:14px;color:#333;margin:24px 0 8px;">Detalle de sesiones actualizadas</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#1a73e8;color:#fff;">
          <th style="padding:8px 10px;text-align:left;border:1px solid #1a73e8;">#</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #1a73e8;">Alumno</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #1a73e8;">Location</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #1a73e8;">Curso</th>
          <th style="padding:8px 10px;text-align:left;border:1px solid #1a73e8;">Horario</th>
          <th style="padding:8px 10px;text-align:center;border:1px solid #1a73e8;">Sesión</th>
        </tr>
      </thead>
      <tbody>${sessionRows}</tbody>
    </table>` : "";

  const HTML = () => `
  <div style="line-height:1.3;margin:0;min-width:100%;padding:0;text-align:left;width:100% !important">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <tr>
      <td style="background:#1a73e8;padding:24px 32px;">
        <h1 style="color:#ffffff;margin:0;font-size:20px;">Reporte Diario — Miniswimmer</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
          <tr style="background:#f0f4ff;">
            <td style="border:1px solid #dde3f0;font-weight:bold;width:40%;">Fecha (Santiago)</td>
            <td style="border:1px solid #dde3f0;">${dateStr}</td>
          </tr>
          <tr>
            <td style="border:1px solid #dde3f0;font-weight:bold;">Sesiones actualizadas</td>
            <td style="border:1px solid #dde3f0;font-weight:bold;color:${totalUpdated === 0 ? "#888" : "#d32f2f"};">${totalUpdated}</td>
          </tr>
          <tr style="background:#f0f4ff;">
            <td style="border:1px solid #dde3f0;font-weight:bold;">Rango UTC procesado</td>
            <td style="border:1px solid #dde3f0;font-size:12px;">${startUTC} → ${endUTC}</td>
          </tr>
          <tr>
            <td colspan="2" style="border:1px solid #dde3f0;padding:12px;color:#333;">${mensaje}</td>
          </tr>
        </table>
        ${sessionTable}
        <p style="font-size:12px;color:#999;margin-top:24px;">Este email fue generado automáticamente por el sistema Miniswimmer.</p>
      </td>
    </tr>
  </table>
  </div>
  `;

  const body = JSON.stringify({
    service_id:  EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id:     EMAILJS_USER_ID,
    accessToken: EMAILJS_ACCESS_TOKEN,
    template_params: {
      to_client_email: toEmail,
      reply_to:        "hola@miniswimmer.cl",
      SUBJECT:         "Sesiones eliminadas por no USO",
      contentHTML:     HTML(),
    },
  });

  const res = await fetch(EMAILJS_API_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS error [${res.status}]: ${text}`);
  }

  console.log(`[dailyCleanup] Email enviado a ${toEmail}`);
}

// ─────────────────────────────────────────────────────────────────────────────

export const handler = async (): Promise<void> => {
  const { start, end, dateStr } = getYesterdayUTCRange();

  console.log(`[dailyCleanup] Ayer Santiago: ${dateStr}`);
  console.log(`[dailyCleanup] Rango UTC: ${start} → ${end}`);

  let lastKey: Record<string, unknown> | undefined;
  let totalUpdated = 0;
  const updatedSessions: SessionRow[] = [];

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "#dt >= :start AND #dt < :end AND #status <> :deleted",
        ExpressionAttributeNames: { "#dt": "date", "#status": "status" },
        ExpressionAttributeValues: { ":start": start, ":end": end, ":deleted": "DELETED" },
        ExclusiveStartKey: lastKey,
      })
    );

    const items = result.Items ?? [];
    console.log(`[dailyCleanup] Página: ${items.length} registros encontrados`);

    // Guardar para el reporte
    for (const item of items) {
      updatedSessions.push({
        id:            item.id as string,
        date:          item.date as string,
        studentId:     item.studentId as string,
        locationId:    (item.locationId ?? "") as string,
        courseId:      (item.courseId ?? "") as string,
        scheduleId:    (item.scheduleId ?? "") as string,
        sessionNumber: item.sessionNumber as number | undefined,
        totalSessions: item.totalSessions as number | undefined,
      });
    }

    const BATCH = 25;
    for (let i = 0; i < items.length; i += BATCH) {
      await Promise.all(
        items.slice(i, i + BATCH).map((item) => updateToDeleted(item.id as string))
      );
      totalUpdated += Math.min(BATCH, items.length - i);
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log(`[dailyCleanup] ✔ Total actualizados a DELETED: ${totalUpdated}`);

  // ── Enriquecer con nombres de estudiantes, locations y cursos ─────────────
  const studentIds  = updatedSessions.map((s) => s.studentId).filter(Boolean);
  const locationIds = updatedSessions.map((s) => s.locationId).filter(Boolean);
  const courseIds   = updatedSessions.map((s) => s.courseId).filter(Boolean);
  const scheduleIds = updatedSessions.map((s) => s.scheduleId).filter(Boolean);

  const [studentNames, locationNames, courseNames, scheduleInfos] = await Promise.all([
    batchGetStudents(studentIds),
    batchGetLocations(locationIds),
    batchGetCourses(courseIds),
    batchGetSchedules(scheduleIds),
  ]);

  // ── Envío de reporte por email ────────────────────────────────────────────
  await Promise.all(
    REPORT_RECIPIENTS.map((email) =>
      sendReportEmail(email, dateStr, totalUpdated, start, end, updatedSessions, studentNames, locationNames, courseNames, scheduleInfos).catch((err) =>
        console.error(`[dailyCleanup] Error enviando email a ${email}:`, err)
      )
    )
  );
};
