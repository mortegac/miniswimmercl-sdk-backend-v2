import { a } from "@aws-amplify/backend";
import { listCognitoUsersFn } from "../../functions/listCognitoUsers/resource";
import { cognitoUserMgmtFn } from "../../functions/cognitoUserMgmt/resource";
import { webpayStartFn } from "../../functions/webpayStart/resource";
import { webpayCommitFn } from "../../functions/webpayCommit/resource";
import { webpayStatusFn } from "../../functions/webpayStatus/resource";
import { webpayTimeoutFn } from "../../functions/webpayTimeout/resource";
import { gmailReplyFn } from "../../functions/gmailReply/resource";
import { gmailSyncFn } from "../../functions/gmailSync/resource";
import { generateEnrollmentFn } from "../../functions/generateEnrollment/resource";
import { removeEnrollmentFn } from "../../functions/removeEnrollment/resource";
import { mercadopagoStartFn } from "../../functions/mercadopagoStart/resource";
import { mercadopagoStatusFn } from "../../functions/mercadopagoStatus/resource";

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

  // ── Generate Enrollment (crea Enrollment + SessionDetails + ShoppingCart) ────

  // Sesión generada en el enrollment: id + fecha formateada "LUNES-07-ABR" + número de sesión
  v2EnrollmentSession: a.customType({
    id:           a.string().required(),
    date:         a.string().required(), // "LUNES-07-ABR"
    sesionNumber: a.integer().required(),
  }),

  v2GenerateEnrollmentResult: a.customType({
    enrollmentId: a.string().required(),
    sessions:     a.ref("v2EnrollmentSession").array().required(),
    cartId:       a.string().required(),
  }),

  v2GenerateEnrollment: a
    .mutation()
    .arguments({
      studentId:     a.string().required(),
      userId:        a.string().required(),
      startDate:     a.string().required(),  // "YYYY-MM-DD"
      sessionTypeId: a.string().required(),
      scheduleId:    a.string().required(),
      courseId:      a.string().required(),
    })
    .returns(a.ref("v2GenerateEnrollmentResult"))
    .handler(a.handler.function(generateEnrollmentFn))
    .authorization((allow) => [allow.authenticated()]),

  // ── Remove Enrollment (soft-delete enrollment + sessions + cart detail) ──────
  v2RemoveEnrollment: a
    .mutation()
    .arguments({
      enrollId:   a.string().required(),
      employeeId: a.string().required(),
    })
    .returns(a.boolean())
    .handler(a.handler.function(removeEnrollmentFn))
    .authorization((allow) => [allow.authenticated()]),

  // v2RenovationEnrollment, v2SendWhatsapp, v2SendEmail — pending Lambda implementation

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

  // ── Tipo de retorno WebpayTimeout ─────────────────────────────────────────
  v2WebpayTimeoutResult: a.customType({
    updated:   a.boolean().required(),
    buy_order: a.string(),
  }),

  // Flujo 2 (timeout >10 min): marca la transacción PENDING como TIMEOUT.
  // ordenCompra es opcional — TBK_ORDEN_COMPRA no siempre viene en la respuesta de Webpay.
  v2WebpayTimeout: a
    .mutation()
    .arguments({ ordenCompra: a.string() })
    .returns(a.ref("v2WebpayTimeoutResult"))
    .handler(a.handler.function(webpayTimeoutFn))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  // ── Tipos de retorno MercadoPago ──────────────────────────────────────────
  v2MercadopagoPreference: a.customType({
    preferenceId:    a.string().required(),
    initPoint:       a.string().required(),
    sandboxInitPoint: a.string().required(),
  }),

  v2MercadopagoStatusResult: a.customType({
    paymentId:        a.string(),
    status:           a.string(),
    statusDetail:     a.string(),
    amount:           a.float(),
    glosa:            a.string(),
    externalReference: a.string(),
    payerEmail:       a.string(),
    paymentMethodId:  a.string(),
    dateApproved:     a.string(),
  }),

  // ── Mutations / Queries MercadoPago ───────────────────────────────────────
  // Crea una preferencia de pago en MercadoPago y retorna la URL de checkout.
  v2MercadopagoStart: a
    .mutation()
    .arguments({
      amount: a.float().required(),
      userId: a.string().required(),
      glosa:  a.string().required(),
      cartId: a.string().required(),
    })
    .returns(a.ref("v2MercadopagoPreference"))
    .handler(a.handler.function(mercadopagoStartFn))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  // Consulta el estado de un pago por su payment_id (retornado por MercadoPago en la back_url).
  v2MercadopagoStatus: a
    .query()
    .arguments({ paymentId: a.string().required() })
    .returns(a.ref("v2MercadopagoStatusResult"))
    .handler(a.handler.function(mercadopagoStatusFn))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  // v2SetCreateEvaluation — pending Lambda implementation (fnCreateEvaluationV2)

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
