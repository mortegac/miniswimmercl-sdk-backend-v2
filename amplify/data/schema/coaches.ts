import { a } from "@aws-amplify/backend";

// ─── COACHES ─────────────────────────────────────────────────────────────────

export const coachesSchema = a.schema({
  v2Coach: a
    .model({
      name: a.string().required(),
      lastName: a.string().required(),
      isCertificated: a.boolean(),
      isActive: a.boolean().default(true),
      email: a.string().required(),
      phone: a.string().default(""),
      whatsapp: a.string().default(""),
      // Relations
      coachSchedules: a.hasMany("v2CoachSchedule", "coachId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2CoachSchedule: a
    .model({
      date: a.date().required(),
      startTime: a.string().required(),
      endTime: a.string().required(),
      isAvailable: a.boolean().default(true),
      isBooked: a.boolean().default(false),
      notes: a.string().default(""),
      // Foreign Keys
      coachId: a.id().required(),
      locationId: a.id().required(),
      scheduleId: a.id(),
      // Relations
      coach: a.belongsTo("v2Coach", "coachId"),
      location: a.belongsTo("v2Location", "locationId"),
      schedule: a.belongsTo("v2Schedule", "scheduleId"),
    })
    .secondaryIndexes((index) => [
      index("coachId").sortKeys(["date"]).name("byCoach"),
      index("locationId").sortKeys(["date"]).name("byLocation"),
      index("date").sortKeys(["coachId"]).name("byDate"),
      index("scheduleId").sortKeys(["date"]).name("bySchedule"),
    ])
    .authorization((allow) => [allow.authenticated()]),
});
