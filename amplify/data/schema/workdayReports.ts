import { a } from "@aws-amplify/backend";

// ─── JORNADA LABORAL ─────────────────────────────────────────────────────────

export const workdayReportsSchema = a.schema({
  v2WorkdayStatus: a.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED", "PENDING_REVIEW"]),

  v2WorkdayReports: a
    .model({
      date: a.datetime().required(),
      day: a.string().required(),
      month: a.string().required(),
      year: a.string().required(),
      startTime: a.datetime().required(),
      endTime: a.datetime(),
      startingTemperature: a.float().default(0),
      endingTemperature: a.float().default(0),
      notes: a.string().default(""),
      status: a.ref("v2WorkdayStatus").required(),
      totalHoursWorked: a.float().default(0),
      totalSales: a.float().default(0),
      totalIssues: a.integer().default(0),
      customersSatisfaction: a.float().default(0),
      // Foreign Keys
      userId: a.id().required(),
      // Relations
      user: a.belongsTo("v2Users", "userId"),
    })
    .secondaryIndexes((index) => [index("date").sortKeys(["userId"]).name("byDate")])
    .authorization((allow) => [allow.authenticated()]),
});
