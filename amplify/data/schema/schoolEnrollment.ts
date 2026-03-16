import { a } from "@aws-amplify/backend";

// ─── ESTUDIANTES / INSCRIPCIONES / SESIONES ──────────────────────────────────

export const schoolEnrollmentSchema = a.schema({
  v2typeofPlans: a.enum([
    "MONTHLY_PLAN",
    "DAY_PLAN",
    "QUARTERLY_PLAN",
    "SEMIANNUAL_PLAN",
    "INVALID_PLAN",
    "PRIVATE_LESSON",
  ]),

  v2SessionStatus: a.enum(["ACTIVE", "USED", "RECOVERED", "DELETED"]),

  v2Student: a
    .model({
      name: a.string().required(),
      lastName: a.string().required(),
      middleName: a.string().required(),
      birthdate: a.string().required(),
      placeOfResidence: a.string().required(),
      contactPhone: a.string().required(),
      whoIsTheContact: a.string().required(),
      emailPhone: a.string().required(),
      gender: a.string().required(),
      country: a.string().default("CHILE"),
      isActive: a.boolean().default(true),
      firstSwimmingClass: a.boolean().default(false),
      attendedDaycare: a.boolean().default(false),
      immersesWithoutSwallowingWater: a.boolean().default(false),
      bornPrematurely: a.boolean().default(false),
      waterOnHisFaceBothersHim: a.boolean().default(false),
      putYourFaceInTheWater: a.boolean().default(false),
      anyIllnessInjuryMedicalCondition: a.string().required(),
      // Relations
      enrollments: a.hasMany("v2Enrollment", "studentId"),
      privateEnrollments: a.hasMany("v2PrivateEnrollment", "studentId"),
      relationships: a.hasMany("v2Relationship", "studentId"),
      sessionDetail: a.hasOne("v2SessionDetail", "studentId"),
      emailSend: a.hasMany("v2EmailSend", "studentId"),
      supportTickets: a.hasMany("v2SupportTicket", "studentId"),
      studentEvaluations: a.hasMany("v2StudentEvaluations", "studentId"),
    })
    .secondaryIndexes((index) => [index("country").name("byCountry")])
    .authorization((allow) => [allow.authenticated()]),

  v2Enrollment: a
    .model({
      amountPaid: a.float().required(),
      startDate: a.string().required(),
      endDate: a.string().required(),
      wasDeleted: a.boolean().default(false),
      wasPaid: a.boolean().default(false),
      timeAWeek: a.float(),
      numberOfSessions: a.integer().required(),
      sessionsLeft: a.float(),
      sessionsUsed: a.float(),
      scheduleId: a.string().default(""),
      scheduleName: a.string().default(""),
      paymentToken: a.string().default(""),
      typeOfPlan: a.ref("v2typeofPlans"),
      // Foreign Keys
      studentId: a.id().required(),
      userId: a.id().required(),
      sessionTypeId: a.id().required(),
      courseId: a.id().required(),
      // Relations
      student: a.belongsTo("v2Student", "studentId"),
      user: a.belongsTo("v2Users", "userId"),
      sessionType: a.belongsTo("v2SessionType", "sessionTypeId"),
      course: a.belongsTo("v2Course", "courseId"),
      shoppingCartDetail: a.hasOne("v2ShoppingCartDetail", "enrollmentId"),
      sessionDetails: a.hasMany("v2SessionDetail", "enrollmentId"),
      emailSends: a.hasMany("v2EmailSend", "enrollmentId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2SessionDetail: a
    .model({
      date: a.datetime().required(),
      locationId: a.string().required().default(""),
      day: a.string().required().default(""),
      month: a.string().required(),
      year: a.string(),
      sessionNumber: a.integer(),
      totalSessions: a.integer(),
      status: a.ref("v2SessionStatus").required(),
      proratedValue: a.float().default(0),
      wasEmailSent: a.boolean().default(false),
      locationIdUsed: a.string().required().default(""),
      modifiedBy: a.string().default(""),
      modifiedByDate: a.datetime(),
      // Foreign Keys
      studentId: a.id().required(),
      courseId: a.id().default("SIN-CURSO"),
      scheduleId: a.id().default("SIN-SCHEDULE"),
      enrollmentId: a.id(),
      privateEnrollmentId: a.id(),
      coachId: a.id(),
      // Relations
      student: a.belongsTo("v2Student", "studentId"),
      course: a.belongsTo("v2Course", "courseId"),
      schedule: a.belongsTo("v2Schedule", "scheduleId"),
      enrollment: a.belongsTo("v2Enrollment", "enrollmentId"),
      privateEnrollment: a.belongsTo("v2PrivateEnrollment", "privateEnrollmentId"),
      coach: a.belongsTo("v2Users", "coachId"),
    })
    .secondaryIndexes((index) => [
      index("date").sortKeys(["studentId"]).name("byDate"),
      index("locationId").sortKeys(["date"]).name("byLocationAndDate"),
      index("studentId").name("bySessionDetailStudent"),
    ])
    .authorization((allow) => [allow.authenticated()]),
});
