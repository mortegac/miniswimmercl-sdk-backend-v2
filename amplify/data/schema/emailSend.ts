import { a } from "@aws-amplify/backend";

// ─── EMAIL / WHATSAPP ────────────────────────────────────────────────────────

export const emailSendSchema = a.schema({
  v2TypeOfEmail: a.enum([
    "WHATSAPP",
    "WHATSAPP_LINK_PAGO",
    "WHATSAPP_LINK_RENOVACION",
    "WELCOME",
    "NOSESSION",
    "UPDATE_SESSION",
  ]),

  v2TypeSend: a.enum(["NONE", "WHATSAPP", "EMAIL"]),

  v2EmailState: a.enum([
    "SEND",
    "REJECT",
    "DELIVERY",
    "SUBSCRIPTION",
    "COMPLAINT",
    "OPEN",
    "DELIVERYDELAY",
    "CLICK",
    "RENDERING_FAILURE",
    "BOUNCE",
  ]),

  v2EmailSend: a
    .model({
      date: a.datetime(),
      typeSend: a.ref("v2TypeSend").required(), // default NONE at app level
      type: a.ref("v2TypeOfEmail").required(),
      contentEmail: a.string().default(""),
      contentMessage: a.string().default(""),
      phone: a.string().default(""),
      phoneState: a.ref("v2EmailState"),
      email: a.string().default(""),
      emailState: a.ref("v2EmailState"),
      // Foreign Keys
      studentId: a.id().required(),
      userSendId: a.id().required(),
      enrollmentId: a.id(),
      privateEnrollmentId: a.id(),
      // Relations
      student: a.belongsTo("v2Student", "studentId"),
      userSend: a.belongsTo("v2Users", "userSendId"),
      enrollment: a.belongsTo("v2Enrollment", "enrollmentId"),
      privateEnrollment: a.belongsTo("v2PrivateEnrollment", "privateEnrollmentId"),
    })
    .secondaryIndexes((index) => [
      index("studentId").name("byStudentEmailSendId"),
      index("userSendId").name("byUserSend"),
      index("enrollmentId").name("byEnrollment"),
    ])
    .authorization((allow) => [allow.authenticated()]),

  v2SentEmail: a
    .model({
      emailState: a.ref("v2EmailState"),
      body: a.string().default(""),
    })
    .authorization((allow) => [allow.authenticated()]),
});
