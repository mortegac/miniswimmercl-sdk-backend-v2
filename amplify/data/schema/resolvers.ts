import { a } from "@aws-amplify/backend";

// ─── CUSTOM MUTATIONS (Lambda-backed) ────────────────────────────────────────
// Equivalente Gen 2 de los @function resolvers del Gen 1.

export const resolversSchema = a.schema({
  v2GenerateEnrollment: a
    .mutation()
    .arguments({
      userId: a.string().required(),
      studentId: a.string().required(),
      startDate: a.string().required(),
      sessionTypeId: a.string().required(),
      scheduleId: a.string().required(),
      courseId: a.string().required(),
    })
    .returns(a.string())
    .handler(a.handler.function("fnCalculateSessionsEnrollmentV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2RemoveEnrollment: a
    .mutation()
    .arguments({
      enrollId: a.string().required(),
      employeeId: a.string().required(),
    })
    .returns(a.string())
    .handler(a.handler.function("fnRemoveEnrollmentV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2RenovationEnrollment: a
    .mutation()
    .arguments({
      enrollId: a.string().required(),
      startDate: a.datetime().required(),
    })
    .returns(a.string())
    .handler(a.handler.function("fnRenovationEnrollmentV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2SendWhatsapp: a
    .mutation()
    .arguments({
      message: a.string().required(),
      phoneNumber: a.string().required(),
      name: a.string().required(),
    })
    .returns(a.string())
    .handler(a.handler.function("sendWhatsappResolverV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2SendEmail: a
    .mutation()
    .arguments({
      templateParams: a.json().required(),
      type: a.string().required(),
    })
    .returns(a.string())
    .handler(a.handler.function("sendEmailResolverV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2SetStart: a
    .mutation()
    .arguments({
      amount: a.float().required(),
      userId: a.string().required(),
      glosa: a.string().required(),
      cartId: a.string().required(),
    })
    .returns(a.string())
    .handler(a.handler.function("webpayStartV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2SetCommit: a
    .mutation()
    .arguments({ token: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function("webpayCommitV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2SetStatus: a
    .mutation()
    .arguments({ token: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function("webpayStatusV2"))
    .authorization((allow) => [allow.authenticated()]),

  v2SetCreateEvaluation: a
    .mutation()
    .arguments({
      sessionsCarriedOut: a.string().required(),
      age: a.string().required(),
      wasApproved: a.boolean(),
      observations: a.string().required(),
      studentId: a.string().required(),
      evaluationLevelId: a.string().required(),
      userId: a.string().required(),
      evaluationDetails: a.json().array(),
    })
    .returns(a.string())
    .handler(a.handler.function("fnCreateEvaluationV2"))
    .authorization((allow) => [allow.authenticated()]),
});
