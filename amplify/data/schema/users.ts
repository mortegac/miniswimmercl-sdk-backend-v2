import { a } from "@aws-amplify/backend";

// ─── USUARIOS ────────────────────────────────────────────────────────────────

export const usersSchema = a.schema({
  v2RelationType: a.enum([
    "NONE", "OTHER", "MOTHER", "FATHER", "GRANDFATHER",
    "GRANDMOTHER", "UNCLE", "AUNT", "FAMILYS_FRIEND", "COUSIN",
  ]),

  v2Users: a
    .model({
      name: a.string().required(),
      email: a.string().required(),
      validated: a.boolean(),
      isEmployed: a.boolean().default(false),
      isActive: a.boolean().default(true),
      isAcademyStudent: a.boolean().default(false),
      salesCommission: a.float().default(0),
      contactPhone: a.string().default(""),
      ig: a.string().default(""),
      firstContact: a.boolean(),
      streetAddress: a.string(),
      city: a.string(),
      state: a.string(),
      zipCode: a.string(),
      country: a.string().default("CHILE"),
      latitude: a.float(),
      longitude: a.float(),
      zoomLevel: a.integer().default(15),
      roleId: a.id(),                                // ← nuevo: FK a v2Roles
      role: a.belongsTo("v2Roles", "roleId"),        // ← nuevo: relación
      emailSend: a.hasMany("v2EmailSend", "userSendId"),
      relationships: a.hasMany("v2Relationship", "userId"),
      // join table relations (reemplaza manyToMany)
      ticketUsers: a.hasMany("v2TicketUser", "userId"),
      userPermissions: a.hasMany("v2UserPermissions", "userId"),
      shoppingCart: a.hasMany("v2ShoppingCart", "userId"),
      shoppingCartSeller: a.hasMany("v2ShoppingCart", "sellerId"),
      paymentTransactions: a.hasMany("v2PaymentTransactions", "usersId"),
      sellersCommissions: a.hasMany("v2SellersCommission", "usersId"),
      enrollments: a.hasMany("v2Enrollment", "userId"),
      privateEnrollments: a.hasMany("v2PrivateEnrollment", "userId"),
      coachedPrivateEnrollments: a.hasMany("v2PrivateEnrollment", "coachId"),
      coachedSessions: a.hasMany("v2SessionDetail", "coachId"),
      studentEvaluations: a.hasMany("v2StudentEvaluations", "userId"),
      workdayReports: a.hasMany("v2WorkdayReports", "userId"),
      shoppingCartDetails: a.hasMany("v2ShoppingCartDetail", "createdById"),
      gmailMessages: a.hasMany("v2GmailInbox", "userId"),
    })
    .secondaryIndexes((index) => [
      index("country").name("byCountry"),
      index("email").name("byEmail"),   // lookup apoderado por email del remitente
    ])
    .authorization((allow) => [allow.authenticated()]),

  v2Relationship: a
    .model({
      relationType: a.ref("v2RelationType").required(),
      userId: a.id().required(),
      studentId: a.id().required(),
      user: a.belongsTo("v2Users", "userId"),
      student: a.belongsTo("v2Student", "studentId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
