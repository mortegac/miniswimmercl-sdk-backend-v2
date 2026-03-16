import { a } from "@aws-amplify/backend";

// ─── CLASES PRIVADAS ─────────────────────────────────────────────────────────

export const privateLessonsSchema = a.schema({
  v2PrivateEnrollment: a
    .model({
      amountPaid: a.float().required(),
      startDate: a.string().required(),
      endDate: a.string().required(),
      wasDeleted: a.boolean().default(false),
      wasPaid: a.boolean().default(false),
      timeAWeek: a.float(),
      numberOfSessions: a.integer().required(),
      scheduleId: a.string().default(""),
      scheduleName: a.string().default(""),
      paymentToken: a.string().default(""),
      typeOfPlan: a.ref("v2typeofPlans"),
      // Location fields
      streetAddress: a.string(),
      city: a.string(),
      state: a.string(),
      zipCode: a.string(),
      country: a.string(),
      latitude: a.float(),
      longitude: a.float(),
      zoomLevel: a.integer(),
      // Foreign Keys
      studentId: a.id(),
      userId: a.id().required(),
      coachId: a.id().required(),
      sessionTypeId: a.id().required(),
      courseId: a.id().required(),
      // Relations
      student: a.belongsTo("v2Student", "studentId"),
      user: a.belongsTo("v2Users", "userId"),
      coach: a.belongsTo("v2Users", "coachId"),
      sessionType: a.belongsTo("v2SessionType", "sessionTypeId"),
      course: a.belongsTo("v2Course", "courseId"),
      shoppingCartDetail: a.hasOne("v2ShoppingCartDetail", "privateEnrollmentId"),
      sessionDetails: a.hasMany("v2SessionDetail", "privateEnrollmentId"),
      emailSends: a.hasMany("v2EmailSend", "privateEnrollmentId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
