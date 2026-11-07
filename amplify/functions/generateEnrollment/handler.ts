/**
 * generateEnrollmentV2 — Lambda handler
 *
 * Equivalent of v1 fnCalculateSessionsEnrollment.
 * Creates: Enrollment + N SessionDetail records + ShoppingCart (if needed) + ShoppingCartDetail.
 *
 * Arguments:
 *   studentId    : string  — ID del alumno
 *   userId       : string  — ID del usuario que realiza la inscripción
 *   startDate    : string  — Fecha de inicio en formato YYYY-MM-DD
 *   sessionTypeId: string  — ID del tipo de sesión (pack)
 *   scheduleId   : string  — ID del horario
 *   courseId     : string  — ID del curso
 *
 * Returns: v2GenerateEnrollmentResult
 *   enrollmentId : string
 *   sessions     : Array<{ id, date, sesionNumber }> — ordenadas ascendente, date = "LUNES-07-ABR"
 *   cartId       : string
 */

import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

// ─── Table env vars ────────────────────────────────────────────────────────────
const SCHEDULE_TABLE             = process.env.SCHEDULE_TABLE!;
const SESSION_TYPE_TABLE         = process.env.SESSION_TYPE_TABLE!;
const ENROLLMENT_TABLE           = process.env.ENROLLMENT_TABLE!;
const SESSION_DETAIL_TABLE       = process.env.SESSION_DETAIL_TABLE!;
const SHOPPING_CART_TABLE        = process.env.SHOPPING_CART_TABLE!;
const SHOPPING_CART_DETAIL_TABLE = process.env.SHOPPING_CART_DETAIL_TABLE!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// ─── Date helpers ─────────────────────────────────────────────────────────────

const WEEK_DAYS_ES       = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const WEEK_DAYS_ES_UPPER = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
const MONTHS_SHORT       = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/**
 * Parse "YYYY-MM-DD" o "MM-DD-YYYY" as local date (avoids UTC off-by-one).
 * El front admin envia MM-DD-YYYY; sin esta deteccion new Date(11, 7, 2026)
 * desborda a fechas ~1917.
 */
function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  const [year, month, day] = parts[0] > 31 ? parts : [parts[2], parts[0], parts[1]];
  return new Date(year, month - 1, day, 12, 0, 0); // noon to avoid DST issues
}

/** Format Date as ISO date string "YYYY-MM-DD". */
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Calculate weekly session dates starting from startDate,
 * advancing to the next occurrence of courseDay if needed.
 * Returns sessions sorted ascending by date.
 */
function calculateSessionDates(
  startDateStr: string,
  courseDay: string,
  numberOfSessions: number,
  totalAmount: number
): Array<{
  date: string;          // ISO datetime (stored in DynamoDB)
  formattedDate: string; // "LUNES-07-ABR" (returned to client)
  day: string;           // "DD"
  month: string;         // "M" (sin cero a la izquierda — igual que v1)
  year: string;          // "YYYY"
  monthShort: string;    // "ENE", "FEB" …
  proratedValue: number;
  sessionNumber: number;
  totalSessions: number;
}> {
  const valorPorSesion = numberOfSessions > 0 ? totalAmount / numberOfSessions : 0;
  const courseDayIndex = WEEK_DAYS_ES.indexOf(courseDay.toLowerCase());
  let current = parseLocalDate(startDateStr);

  // Advance to the first occurrence of courseDay on or after startDate
  if (courseDayIndex >= 0) {
    while (current.getDay() !== courseDayIndex) {
      current.setDate(current.getDate() + 1);
    }
  }

  const sessions = [];
  for (let i = 0; i < numberOfSessions; i++) {
    const dayName = WEEK_DAYS_ES_UPPER[current.getDay()];
    const dayNum  = String(current.getDate()).padStart(2, "0");
    const month   = MONTHS_SHORT[current.getMonth()];

    sessions.push({
      date:          current.toISOString(),
      formattedDate: `${dayName}-${dayNum}-${month}`,
      day:           dayNum,
      month:         String(current.getMonth() + 1), // sin cero — igual que v1
      year:          String(current.getFullYear()),
      monthShort:    month,
      proratedValue: parseFloat(valorPorSesion.toFixed(2)),
      sessionNumber: i + 1,
      totalSessions: numberOfSessions,
    });
    current.setDate(current.getDate() + 7);
  }

  // Already in ascending order (each iteration adds 7 days), but sort explicitly
  sessions.sort((a, b) => a.date.localeCompare(b.date));

  return sessions;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler: Handler = async (event) => {
  const args = event?.arguments ?? event;
  const {
    studentId,
    userId,
    startDate,
    sessionTypeId,
    scheduleId,
    courseId,
  } = args as {
    studentId:     string;
    userId:        string;
    startDate:     string;
    sessionTypeId: string;
    scheduleId:    string;
    courseId:      string;
  };

  // ── Validation ───────────────────────────────────────────────────────────────
  const missing = ["studentId", "userId", "startDate", "sessionTypeId", "scheduleId", "courseId"]
    .filter((k) => !args[k]);
  if (missing.length) {
    throw new Error(`Missing required arguments: ${missing.join(", ")}`);
  }

  // ── 1. Fetch Schedule ─────────────────────────────────────────────────────────
  const scheduleRes = await ddb.send(
    new GetCommand({ TableName: SCHEDULE_TABLE, Key: { id: scheduleId } })
  );
  if (!scheduleRes.Item) throw new Error(`Schedule not found: ${scheduleId}`);
  const schedule = scheduleRes.Item as {
    id: string;
    day: string;
    startHour: string;
    locationSchedulesId?: string;
  };

  // ── 2. Fetch SessionType ──────────────────────────────────────────────────────
  const stRes = await ddb.send(
    new GetCommand({ TableName: SESSION_TYPE_TABLE, Key: { id: sessionTypeId } })
  );
  if (!stRes.Item) throw new Error(`SessionType not found: ${sessionTypeId}`);
  const sessionType = stRes.Item as {
    id: string;
    totalSessions: number;
    amount: number;
    timeAWeek?: number;
  };

  const numberOfSessions = Math.round(sessionType.totalSessions ?? 0);
  const amount           = sessionType.amount ?? 0;
  const timeAWeek        = sessionType.timeAWeek ?? 1;
  const locationId       = schedule.locationSchedulesId ?? "";
  const scheduleName     = `${schedule.day} ${schedule.startHour}`;

  // ── 3. Calculate end date (startDate + 30 days) ───────────────────────────────
  const startDateObj = parseLocalDate(startDate);
  const endDateObj   = new Date(startDateObj);
  endDateObj.setDate(startDateObj.getDate() + 30);
  const endDate = toISODate(endDateObj);

  // ── 4. Create Enrollment ──────────────────────────────────────────────────────
  const enrollmentId = randomUUID();
  const now          = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: ENROLLMENT_TABLE,
      Item: {
        id:              enrollmentId,
        __typename:      "v2Enrollment",
        startDate,
        endDate,
        amountPaid:      amount,
        wasPaid:         false,
        wasDeleted:      false,
        timeAWeek,
        numberOfSessions,
        sessionsLeft:    numberOfSessions,
        sessionsUsed:    0,
        scheduleId,
        scheduleName,
        paymentToken:    "",
        studentId,
        userId,
        sessionTypeId,
        courseId,
        createdAt:       now,
        updatedAt:       now,
      },
    })
  );

  // ── 5. Calculate + create SessionDetail records ───────────────────────────────
  const sessionDates = calculateSessionDates(startDate, schedule.day, numberOfSessions, amount);
  const sessions: Array<{ id: string; date: string; sesionNumber: number }> = [];

  for (const s of sessionDates) {
    const sessionId = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: SESSION_DETAIL_TABLE,
        Item: {
          id:                sessionId,
          __typename:        "v2SessionDetail",
          date:              s.date,
          day:               s.day,
          month:             s.month,
          year:              s.year,
          sessionNumber:     s.sessionNumber,
          totalSessions:     s.totalSessions,
          proratedValue:     s.proratedValue,
          status:            "ACTIVE",
          wasEmailSent:      false,
          locationId,
          locationIdUsed:    "",
          modifiedBy:        "",
          modifiedByDate:    "1800-01-01T00:00:00.000Z",
          studentId,
          courseId,
          scheduleId,
          enrollmentId,
          createdAt:         now,
          updatedAt:         now,
        },
      })
    );
    sessions.push({ id: sessionId, date: s.formattedDate, sesionNumber: s.sessionNumber });
  }

  // ── 6. Find or create ShoppingCart ───────────────────────────────────────────
  let cartId: string | undefined;

  try {
    const cartRes = await ddb.send(
      new QueryCommand({
        TableName:                 SHOPPING_CART_TABLE,
        IndexName:                 "gsi-v2Users.shoppingCart",
        KeyConditionExpression:    "userId = :uid",
        FilterExpression:          "#s = :pending",
        ExpressionAttributeNames:  { "#s": "status" },
        ExpressionAttributeValues: { ":uid": userId, ":pending": "PENDING" },
        Limit: 1,
      })
    );
    if ((cartRes.Items?.length ?? 0) > 0) {
      cartId = (cartRes.Items![0] as { id: string }).id;
    }
  } catch (err) {
    console.warn("[generateEnrollment] GSI query failed, creating new cart:", err);
  }

  if (!cartId) {
    cartId = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: SHOPPING_CART_TABLE,
        Item: {
          id:         cartId,
          __typename: "v2ShoppingCart",
          totalPrice: amount,
          status:     "PENDING",
          userId,
          sellerId:   userId,
          createdAt:  now,
          updatedAt:  now,
        },
      })
    );
  }

  // ── 7. Create ShoppingCartDetail ──────────────────────────────────────────────
  const cartDetailId = randomUUID();
  await ddb.send(
    new PutCommand({
      TableName: SHOPPING_CART_DETAIL_TABLE,
      Item: {
        id:           cartDetailId,
        __typename:   "v2ShoppingCartDetail",
        type:         "ENROLLMENTS",
        quantity:     1,
        amount,
        detail:       `Inscripción ${scheduleName} — ${numberOfSessions} sesiones`,
        wasDeleted:   false,
        cartId,
        enrollmentId,
        createdAt:    now,
        updatedAt:    now,
      },
    })
  );

  // ── 8. Return result ──────────────────────────────────────────────────────────
  console.log(
    `[generateEnrollment] OK — enrollmentId=${enrollmentId}, sessions=${sessions.length}, cartId=${cartId}`
  );

  return {
    enrollmentId,
    sessions,
    cartId,
  };
};
