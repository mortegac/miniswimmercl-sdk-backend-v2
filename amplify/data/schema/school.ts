import { a } from "@aws-amplify/backend";

// ─── SEDES / CURSOS / HORARIOS / SESIONES ────────────────────────────────────
// manyToMany → tabla join v2CourseSessionType (Gen 2 v1.x compatible)

export const schoolSchema = a.schema({
  v2AgeGroupType: a.enum(["ALL", "BABIES", "CHILDREN", "ADULTS", "PREGNANT", "OLDER_ADULTS"]),
  v2AgeType: a.enum(["MONTHS", "YEARS", "ALL"]),
  v2DayType: a.enum(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]),

  v2Location: a
    .model({
      name: a.string().default(""),
      city: a.string().default(""),
      country: a.string().default("CHILE"),
      region: a.string().default("SANTIAGO"),
      group: a.string().default("NONE"),
      minimumTemperature: a.integer().default(28),
      maximumTemperature: a.integer().default(30),
      address: a.string().default(""),
      phone: a.string().default(""),
      imageMap: a.string().default(""),
      urlMap: a.string().default(""),
      directions: a.string().default(""),
      isActive: a.boolean().default(true),
      isVisible: a.boolean().default(true),
      courses: a.hasMany("v2Course", "locationId"),
      schedules: a.hasMany("v2Schedule", "locationSchedulesId"),
      expenses: a.hasMany("v2Expense", "locationId"),
      coachSchedules: a.hasMany("v2CoachSchedule", "locationId"),
    })
    .secondaryIndexes((index) => [index("country").name("byCountry")])
    .authorization((allow) => [allow.authenticated()]),

  v2Course: a
    .model({
      title: a.string().required(),
      description: a.string(),
      startingAge: a.float(),
      endingAge: a.float(),
      ageType: a.ref("v2AgeType").required(),
      ageGroupType: a.ref("v2AgeGroupType").required(),
      duration: a.string().required(),
      isActive: a.boolean().default(false),
      locationId: a.id(),
      location: a.belongsTo("v2Location", "locationId"),
      schedules: a.hasMany("v2Schedule", "courseSchedulesId"),
      courseSessionTypes: a.hasMany("v2CourseSessionType", "courseId"),
      enrollments: a.hasMany("v2Enrollment", "courseId"),
      privateEnrollments: a.hasMany("v2PrivateEnrollment", "courseId"),
      sessionDetails: a.hasMany("v2SessionDetail", "courseId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2Schedule: a
    .model({
      day: a.ref("v2DayType").required(),
      startHour: a.string().required(),
      endHour: a.string().required(),
      isActive: a.boolean().default(false),
      minimumQuotas: a.integer().default(0),
      maximumQuotas: a.integer().default(0),
      locationSchedulesId: a.id(),
      courseSchedulesId: a.id(),
      course: a.belongsTo("v2Course", "courseSchedulesId"),
      location: a.belongsTo("v2Location", "locationSchedulesId"),
      sessionDetails: a.hasMany("v2SessionDetail", "scheduleId"),
      coachSchedules: a.hasMany("v2CoachSchedule", "scheduleId"),
    })
    .secondaryIndexes((index) => [
      index("locationSchedulesId").sortKeys(["courseSchedulesId"]).name("byLocationAndCourse").queryField("schedulesByLocationAndCourse"),
      index("courseSchedulesId").name("byCourse").queryField("schedulesByCourse"),
    ])
    .authorization((allow) => [allow.authenticated()]),

  v2SessionType: a
    .model({
      name: a.string().required(),
      description: a.string(),
      durationSession: a.integer().default(0),
      timeAWeek: a.float(),
      totalSessions: a.float(),
      amount: a.float(),
      isActive: a.boolean().default(false),
      isTestClass: a.boolean().default(false),
      packValidity: a.integer(),
      courseSessionTypes: a.hasMany("v2CourseSessionType", "sessionTypeId"),
      enrollments: a.hasMany("v2Enrollment", "sessionTypeId"),
      privateEnrollments: a.hasMany("v2PrivateEnrollment", "sessionTypeId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  // Join table: Course ↔ SessionType
  v2CourseSessionType: a
    .model({
      courseId: a.id().required(),
      sessionTypeId: a.id().required(),
      course: a.belongsTo("v2Course", "courseId"),
      sessionType: a.belongsTo("v2SessionType", "sessionTypeId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
