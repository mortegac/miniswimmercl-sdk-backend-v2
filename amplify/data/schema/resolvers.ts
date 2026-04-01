import { a } from "@aws-amplify/backend";
import { listCognitoUsersFn } from "../../functions/listCognitoUsers/resource";
import { cognitoUserMgmtFn } from "../../functions/cognitoUserMgmt/resource";
import { webpayStartFn } from "../../functions/webpayStart/resource";
import { webpayCommitFn } from "../../functions/webpayCommit/resource";
import { webpayStatusFn } from "../../functions/webpayStatus/resource";
import { gmailReplyFn } from "../../functions/gmailReply/resource";
import { gmailSyncFn } from "../../functions/gmailSync/resource";

// ─── CUSTOM MUTATIONS / QUERIES (Lambda-backed) ───────────────────────────────
// Equivalente Gen 2 de los @function resolvers del Gen 1.

export const resolversSchema = a.schema({
  // ── Tipo de retorno para cada usuario de Cognito ──────────────────────────
  v2CognitoUser: a.customType({
    sub: a.string().required(),
    email: a.string().required(),
    name: a.string(),
    enabled: a.boolean().required(),
    status: a.string().required(),
    createdAt: a.string().required(),
  }),

  // ── Query: listar usuarios del User Pool con paginación y filtrado ─────────
  v2ListCognitoUsers: a
    .query()
    .arguments({
      limit: a.integer(),       // máximo 60 por página (límite Cognito)
      nextToken: a.string(),    // token de paginación
      filter: a.string(),       // ej: "email ^= \"juan\"" (sintaxis Cognito)
    })
    .returns(
      a.customType({
        users: a.ref("v2CognitoUser").array().required(),
        nextToken: a.string(),
      })
    )
    .handler(a.handler.function(listCognitoUsersFn))
    .authorization((allow) => [allow.authenticated()]),

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

  // ── Tipos de retorno Webpay ───────────────────────────────────────────────
  v2WebpayStartResult: a.customType({
    token: a.string().required(),
    url:   a.string().required(),
    orden: a.integer().required(),
  }),

  v2WebpayTransactionResult: a.customType({
    status:               a.string(),
    buy_order:            a.string(),
    session_id:           a.string(),
    amount:               a.float(),
    transaction_date:     a.string(),
    accounting_date:      a.string(),
    authorization_code:   a.string(),
    payment_type_code:    a.string(),
    response_code:        a.integer(),
    installments_number:  a.integer(),
    installments_amount:  a.float(),
    vci:                  a.string(),
    card_number:          a.string(),
  }),

  // ── Mutations Webpay ──────────────────────────────────────────────────────
  v2WebpayStart: a
    .mutation()
    .arguments({
      amount: a.float().required(),
      userId: a.string().required(),
      glosa:  a.string().required(),
      cartId: a.string().required(),
    })
    .returns(a.ref("v2WebpayStartResult"))
    .handler(a.handler.function(webpayStartFn))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  v2WebpayCommit: a
    .mutation()
    .arguments({ token: a.string().required() })
    .returns(a.ref("v2WebpayTransactionResult"))
    .handler(a.handler.function(webpayCommitFn))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  v2WebpayStatus: a
    .mutation()
    .arguments({ token: a.string().required() })
    .returns(a.ref("v2WebpayTransactionResult"))
    .handler(a.handler.function(webpayStatusFn))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

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

  // ── Cognito User Management ───────────────────────────────────────────────

  // Cambia la contraseña de un usuario (AdminSetUserPassword)
  v2CognitoSetPassword: a
    .mutation()
    .arguments({
      email:     a.string().required(),
      password:  a.string().required(),
      permanent: a.boolean(),             // true = permanente, false = temporal (fuerza cambio)
    })
    .returns(a.boolean())
    .handler(a.handler.function(cognitoUserMgmtFn))
    .authorization((allow) => [allow.authenticated()]),

  // Habilita o deshabilita un usuario en Cognito
  v2CognitoSetStatus: a
    .mutation()
    .arguments({
      email:   a.string().required(),
      enabled: a.boolean().required(),
    })
    .returns(a.boolean())
    .handler(a.handler.function(cognitoUserMgmtFn))
    .authorization((allow) => [allow.authenticated()]),

  // Tipo de retorno para creación de usuario Cognito+DynamoDB
  v2CognitoCreateUserResult: a.customType({
    email:  a.string().required(),
    name:   a.string(),
    roleId: a.string(),
  }),

  // Crea el usuario en Cognito (AdminCreateUser) y en DynamoDB (v2Users)
  v2CognitoCreateUser: a
    .mutation()
    .arguments({
      email:             a.string().required(),
      name:              a.string().required(),
      temporaryPassword: a.string().required(),
      contactPhone:      a.string(),
      roleId:            a.string(),
      isEmployed:        a.boolean(),
    })
    .returns(a.ref("v2CognitoCreateUserResult"))
    .handler(a.handler.function(cognitoUserMgmtFn))
    .authorization((allow) => [allow.authenticated()]),

  // ── Gmail Sync (on-demand) ────────────────────────────────────────────────
  v2GmailSync: a
    .mutation()
    .arguments({})
    .returns(a.json())
    .handler(a.handler.function(gmailSyncFn))
    .authorization((allow) => [allow.authenticated()]),

  // ── Gmail Reply ───────────────────────────────────────────────────────────
  v2GmailReplyResult: a.customType({
    success:   a.boolean().required(),
    messageId: a.string(),
    error:     a.string(),
  }),

  v2GmailReply: a
    .mutation()
    .arguments({
      fromAccount:          a.string().required(),  // hola@miniswimmer.cl | welcome@miniswimmer.cl
      toEmail:              a.string().required(),
      subject:              a.string().required(),
      body:                 a.string().required(),
      threadId:             a.string(),             // para mantener el hilo en Gmail
      inReplyToMessageId:   a.string(),             // Message-ID header del email original
    })
    .returns(a.ref("v2GmailReplyResult"))
    .handler(a.handler.function(gmailReplyFn))
    .authorization((allow) => [allow.authenticated()]),
});
