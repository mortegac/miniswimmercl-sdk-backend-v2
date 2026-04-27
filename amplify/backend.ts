import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaTarget } from "aws-cdk-lib/aws-events-targets";
import { Stack } from "aws-cdk-lib";
import { CfnUserPoolClient } from "aws-cdk-lib/aws-cognito";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { postConfirmationFn } from "./functions/postConfirmation/resource";
import { listCognitoUsersFn } from "./functions/listCognitoUsers/resource";
import { dailyCleanupSessionsFn } from "./functions/dailyCleanupSessions/resource";
import { webpayStartFn } from "./functions/webpayStart/resource";
import { webpayCommitFn } from "./functions/webpayCommit/resource";
import { webpayStatusFn } from "./functions/webpayStatus/resource";
import { webpayTimeoutFn } from "./functions/webpayTimeout/resource";
import { gmailSyncFn } from "./functions/gmailSync/resource";
import { gmailReplyFn } from "./functions/gmailReply/resource";
import { cognitoUserMgmtFn } from "./functions/cognitoUserMgmt/resource";
import { generateEnrollmentFn } from "./functions/generateEnrollment/resource";
import { removeEnrollmentFn } from "./functions/removeEnrollment/resource";
import { mercadopagoStartFn } from "./functions/mercadopagoStart/resource";
import { mercadopagoStatusFn } from "./functions/mercadopagoStatus/resource";

/**
 * V2 Backend - Amplify Gen 2
 *
 * Backend independiente del Gen 1. No interfiere con producción.
 *
 * Para desarrollo local:   npx ampx sandbox --profile MINISWIMMER-05FEB2026
 * Para CI/CD:              npx ampx pipeline-deploy
 */
export const backend = defineBackend({
  auth,
  data,
  postConfirmationFn,
  listCognitoUsersFn,
  cognitoUserMgmtFn,
  dailyCleanupSessionsFn,
  webpayStartFn,
  webpayCommitFn,
  webpayStatusFn,
  webpayTimeoutFn,
  gmailSyncFn,
  gmailReplyFn,
  generateEnrollmentFn,
  removeEnrollmentFn,
  mercadopagoStartFn,
  mercadopagoStatusFn,
});

// ── Cognito User Pool Client: habilitar USER_PASSWORD_AUTH ────────────────────
// Requerido para que el frontend use authFlowType: 'USER_PASSWORD_AUTH' en signIn
const { cfnUserPoolClient } = backend.auth.resources.cfnResources;
(cfnUserPoolClient as CfnUserPoolClient).explicitAuthFlows = [
  "ALLOW_CUSTOM_AUTH",
  "ALLOW_REFRESH_TOKEN_AUTH",
  "ALLOW_USER_SRP_AUTH",
  "ALLOW_USER_PASSWORD_AUTH",
];

// ── postConfirmation (resourceGroupName: "auth") ──────────────────────────────
// Usa IAM wildcard para DynamoDB — evita referencia CDK cruzada auth↔data
const postConfirmLambda = backend.postConfirmationFn.resources.lambda as LambdaFunction;
const { region, account } = Stack.of(postConfirmLambda);

postConfirmLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:PutItem"],
    resources: [`arn:aws:dynamodb:${region}:${account}:table/v2Users-*`],
  })
);
postConfirmLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:ListTables"],
    resources: ["*"],
  })
);

// ── listCognitoUsers (resourceGroupName: "data") ──────────────────────────────
// data→auth es dirección válida (data ya depende de auth para autorización)
const listCognitoLambda = backend.listCognitoUsersFn.resources.lambda as LambdaFunction;

listCognitoLambda.addEnvironment(
  "USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId
);
listCognitoLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:ListUsers"],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

// ── dailyCleanupSessions (resourceGroupName: "data") ─────────────────────────
// Cron: 11:00 UTC = 08:00 Santiago verano (UTC-3, CLST)
//       La Lambda calcula el offset real en runtime para manejar DST correctamente
const cleanupLambda = backend.dailyCleanupSessionsFn.resources.lambda as LambdaFunction;
const sessionDetailTable = backend.data.resources.tables["v2SessionDetail"];
const studentTable       = backend.data.resources.tables["v2Student"];
const locationTable      = backend.data.resources.tables["v2Location"];
const courseTable        = backend.data.resources.tables["v2Course"];
const scheduleTable      = backend.data.resources.tables["v2Schedule"];

sessionDetailTable.grantReadWriteData(cleanupLambda);
studentTable.grantReadData(cleanupLambda);
locationTable.grantReadData(cleanupLambda);
courseTable.grantReadData(cleanupLambda);
scheduleTable.grantReadData(cleanupLambda);

cleanupLambda.addEnvironment("SESSION_DETAIL_TABLE", sessionDetailTable.tableName);
cleanupLambda.addEnvironment("STUDENT_TABLE",        studentTable.tableName);
cleanupLambda.addEnvironment("LOCATION_TABLE",       locationTable.tableName);
cleanupLambda.addEnvironment("COURSE_TABLE",         courseTable.tableName);
cleanupLambda.addEnvironment("SCHEDULE_TABLE",       scheduleTable.tableName);

// EmailJS credentials
cleanupLambda.addEnvironment("EMAILJS_SERVICE_ID",   "service_ucb8wga");
cleanupLambda.addEnvironment("EMAILJS_TEMPLATE_ID",  "template_ekdpvof");
cleanupLambda.addEnvironment("EMAILJS_USER_ID",      "Csc41asZklkk5HTWk");
cleanupLambda.addEnvironment("EMAILJS_ACCESS_TOKEN", "pwob33iN7KomWRFooA0TT");

new Rule(Stack.of(cleanupLambda), "DailyCleanupSessionsRule", {
  schedule: Schedule.cron({ hour: "11", minute: "0" }),  // 08:00 Santiago verano
  targets: [new LambdaTarget(cleanupLambda)],
});

// ── webpayStart (resourceGroupName: "data") ───────────────────────────────────
const webpayStartLambda = backend.webpayStartFn.resources.lambda as LambdaFunction;
const correlativesTable = backend.data.resources.tables["v2Correlatives"];
const paymentTransactionsTable = backend.data.resources.tables["v2PaymentTransactions"];

correlativesTable.grantReadWriteData(webpayStartLambda);
paymentTransactionsTable.grantWriteData(webpayStartLambda);

// grantReadWriteData no cubre dynamodb:Query en GSIs → agregar explícitamente
const { region: wpStartRegion, account: wpStartAccount } = Stack.of(webpayStartLambda);
webpayStartLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [
      `arn:aws:dynamodb:${wpStartRegion}:${wpStartAccount}:table/v2Correlatives-*/index/*`,
      `arn:aws:dynamodb:${wpStartRegion}:${wpStartAccount}:table/v2PaymentTransactions-*/index/*`,
    ],
  })
);

webpayStartLambda.addToRolePolicy(
  new PolicyStatement({
    actions:   ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:${wpStartRegion}:${wpStartAccount}:secret:miniswimmer/transbank-production*`],
  })
);

webpayStartLambda.addEnvironment("CORRELATIVES_TABLE",          correlativesTable.tableName);
webpayStartLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE",  paymentTransactionsTable.tableName);
webpayStartLambda.addEnvironment("TRANSBANK_SECRET_NAME",       "miniswimmer/transbank-production");
webpayStartLambda.addEnvironment(
  "WEBPAY_RETURN_URL",
  process.env.WEBPAY_RETURN_URL ?? "https://pagos.miniswimmer.cl/return"
);

// ── webpayCommit (resourceGroupName: "data") ──────────────────────────────────
// Commit confirma la transacción y actualiza DB/cart/enrollments (flujo normal)
const webpayCommitLambda = backend.webpayCommitFn.resources.lambda as LambdaFunction;
const shoppingCartTable       = backend.data.resources.tables["v2ShoppingCart"];
const shoppingCartDetailTable = backend.data.resources.tables["v2ShoppingCartDetail"];
const enrollmentTable         = backend.data.resources.tables["v2Enrollment"];
const academyEnrollmentTable  = backend.data.resources.tables["v2AcademyEnrollment"];
const privateEnrollmentTable  = backend.data.resources.tables["v2PrivateEnrollment"];

paymentTransactionsTable.grantReadWriteData(webpayCommitLambda);
shoppingCartTable.grantReadWriteData(webpayCommitLambda);
shoppingCartDetailTable.grantReadData(webpayCommitLambda);
enrollmentTable.grantReadWriteData(webpayCommitLambda);
academyEnrollmentTable.grantReadWriteData(webpayCommitLambda);
privateEnrollmentTable.grantReadWriteData(webpayCommitLambda);

const { region: wpCommitRegion, account: wpCommitAccount } = Stack.of(webpayCommitLambda);
webpayCommitLambda.addToRolePolicy(
  new PolicyStatement({
    actions:   ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:${wpCommitRegion}:${wpCommitAccount}:secret:miniswimmer/transbank-production*`],
  })
);

webpayCommitLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE",  paymentTransactionsTable.tableName);
webpayCommitLambda.addEnvironment("SHOPPING_CART_TABLE",         shoppingCartTable.tableName);
webpayCommitLambda.addEnvironment("SHOPPING_CART_DETAIL_TABLE",  shoppingCartDetailTable.tableName);
webpayCommitLambda.addEnvironment("ENROLLMENT_TABLE",            enrollmentTable.tableName);
webpayCommitLambda.addEnvironment("ACADEMY_ENROLLMENT_TABLE",    academyEnrollmentTable.tableName);
webpayCommitLambda.addEnvironment("PRIVATE_ENROLLMENT_TABLE",    privateEnrollmentTable.tableName);
webpayCommitLambda.addEnvironment("TRANSBANK_SECRET_NAME",       "miniswimmer/transbank-production");

// ── webpayStatus (resourceGroupName: "data") ──────────────────────────────────
// Status se usa en Flow 3 (cancelación) — actualiza v2PaymentTransactions y,
// si Transbank aprueba, también actualiza v2ShoppingCart a AUTHORIZED.
const webpayStatusLambda = backend.webpayStatusFn.resources.lambda as LambdaFunction;

paymentTransactionsTable.grantReadWriteData(webpayStatusLambda);
shoppingCartTable.grantReadWriteData(webpayStatusLambda);

// grantReadWriteData no cubre dynamodb:Query en GSIs → agregar explícitamente
const { region: wpStatusRegion, account: wpStatusAccount } = Stack.of(webpayStatusLambda);
webpayStatusLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [
      `arn:aws:dynamodb:${wpStatusRegion}:${wpStatusAccount}:table/v2PaymentTransactions-*/index/*`,
    ],
  })
);

webpayStatusLambda.addToRolePolicy(
  new PolicyStatement({
    actions:   ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:${wpStatusRegion}:${wpStatusAccount}:secret:miniswimmer/transbank-production*`],
  })
);

webpayStatusLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE", paymentTransactionsTable.tableName);
webpayStatusLambda.addEnvironment("SHOPPING_CART_TABLE",        shoppingCartTable.tableName);
webpayStatusLambda.addEnvironment("TRANSBANK_SECRET_NAME",      "miniswimmer/transbank-production");

// ── webpayTimeout (resourceGroupName: "data") ─────────────────────────────────
// Flujo 2 (timeout >10 min): busca la transacción PENDING por buy_order y la
// marca como TIMEOUT usando el GSI byBuyOrder.
const webpayTimeoutLambda = backend.webpayTimeoutFn.resources.lambda as LambdaFunction;

paymentTransactionsTable.grantReadWriteData(webpayTimeoutLambda);

const { region: wpTimeoutRegion, account: wpTimeoutAccount } = Stack.of(webpayTimeoutLambda);
webpayTimeoutLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [
      `arn:aws:dynamodb:${wpTimeoutRegion}:${wpTimeoutAccount}:table/v2PaymentTransactions-*/index/*`,
    ],
  })
);

webpayTimeoutLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE", paymentTransactionsTable.tableName);

// ── gmailSyncV2 (resourceGroupName: "data") ───────────────────────────────────
// Reads Gmail inbox via Google Service Account (domain-wide delegation)
// Cron: 11:00 UTC = 08:00 Santiago verano (UTC-3, CLST)
const gmailLambda = backend.gmailSyncFn.resources.lambda as LambdaFunction;
const gmailTable  = backend.data.resources.tables["v2GmailInbox"];

// DynamoDB read/write access
const gmailUsersTable = backend.data.resources.tables["v2Users"];
gmailTable.grantReadWriteData(gmailLambda);
gmailUsersTable.grantReadData(gmailLambda);
gmailLambda.addEnvironment("GMAIL_INBOX_TABLE", gmailTable.tableName);
gmailLambda.addEnvironment("USERS_TABLE",       gmailUsersTable.tableName);

// Explicit policy to cover GSI queries on both tables
const { region: gmailRegion, account: gmailAccount } = Stack.of(gmailLambda);
gmailLambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:Scan",
    ],
    resources: [
      `arn:aws:dynamodb:${gmailRegion}:${gmailAccount}:table/v2GmailInbox-*`,
      `arn:aws:dynamodb:${gmailRegion}:${gmailAccount}:table/v2GmailInbox-*/index/*`,
      `arn:aws:dynamodb:${gmailRegion}:${gmailAccount}:table/v2Users-*`,
      `arn:aws:dynamodb:${gmailRegion}:${gmailAccount}:table/v2Users-*/index/*`,
    ],
  })
);

// Secrets Manager access
gmailLambda.addToRolePolicy(
  new PolicyStatement({
    actions:   ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:${gmailRegion}:${gmailAccount}:secret:miniswimmer/gmail-service-account*`],
  })
);
gmailLambda.addEnvironment("GMAIL_SECRET_NAME", "miniswimmer/gmail-service-account");
gmailLambda.addEnvironment("GMAIL_ACCOUNTS",    "hola@miniswimmer.cl,welcome@miniswimmer.cl");

// EventBridge daily cron — 11:00 UTC = 08:00 Santiago
new Rule(Stack.of(gmailLambda), "GmailSyncDailyRule", {
  schedule: Schedule.cron({ hour: "11", minute: "0" }),
  targets:  [new LambdaTarget(gmailLambda)],
});

// ── cognitoUserMgmt (resourceGroupName: "data") ───────────────────────────────
// Gestión de usuarios Cognito: setPassword, setStatus, createUser+DynamoDB
const cognitoMgmtLambda = backend.cognitoUserMgmtFn.resources.lambda as LambdaFunction;
const { region: mgmtRegion, account: mgmtAccount } = Stack.of(cognitoMgmtLambda);
const usersTableForMgmt = backend.data.resources.tables["v2Users"];

cognitoMgmtLambda.addEnvironment(
  "USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId
);
cognitoMgmtLambda.addEnvironment("USERS_TABLE", usersTableForMgmt.tableName);

cognitoMgmtLambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminCreateUser",
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

cognitoMgmtLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:PutItem"],
    resources: [`arn:aws:dynamodb:${mgmtRegion}:${mgmtAccount}:table/v2Users-*`],
  })
);

// ── gmailReplyV2 (resourceGroupName: "data") ──────────────────────────────────
// Sends replies via Gmail API using Service Account domain-wide delegation
const gmailReplyLambda = backend.gmailReplyFn.resources.lambda as LambdaFunction;
const { region: replyRegion, account: replyAccount } = Stack.of(gmailReplyLambda);

gmailReplyLambda.addToRolePolicy(
  new PolicyStatement({
    actions:   ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:${replyRegion}:${replyAccount}:secret:miniswimmer/gmail-service-account*`],
  })
);
gmailReplyLambda.addEnvironment("GMAIL_SECRET_NAME", "miniswimmer/gmail-service-account");

// ── generateEnrollmentV2 (resourceGroupName: "data") ──────────────────────────
// Crea Enrollment + SessionDetails + ShoppingCart + ShoppingCartDetail
const generateEnrollmentLambda = backend.generateEnrollmentFn.resources.lambda as LambdaFunction;

const genScheduleTable           = backend.data.resources.tables["v2Schedule"];
const genSessionTypeTable        = backend.data.resources.tables["v2SessionType"];
const genEnrollmentTable         = backend.data.resources.tables["v2Enrollment"];
const genSessionDetailTable      = backend.data.resources.tables["v2SessionDetail"];
const genShoppingCartTable       = backend.data.resources.tables["v2ShoppingCart"];
const genShoppingCartDetailTable = backend.data.resources.tables["v2ShoppingCartDetail"];

genScheduleTable.grantReadData(generateEnrollmentLambda);
genSessionTypeTable.grantReadData(generateEnrollmentLambda);
genEnrollmentTable.grantWriteData(generateEnrollmentLambda);
genSessionDetailTable.grantWriteData(generateEnrollmentLambda);
genShoppingCartTable.grantReadWriteData(generateEnrollmentLambda);
genShoppingCartDetailTable.grantWriteData(generateEnrollmentLambda);

generateEnrollmentLambda.addEnvironment("SCHEDULE_TABLE",             genScheduleTable.tableName);
generateEnrollmentLambda.addEnvironment("SESSION_TYPE_TABLE",         genSessionTypeTable.tableName);
generateEnrollmentLambda.addEnvironment("ENROLLMENT_TABLE",           genEnrollmentTable.tableName);
generateEnrollmentLambda.addEnvironment("SESSION_DETAIL_TABLE",       genSessionDetailTable.tableName);
generateEnrollmentLambda.addEnvironment("SHOPPING_CART_TABLE",        genShoppingCartTable.tableName);
generateEnrollmentLambda.addEnvironment("SHOPPING_CART_DETAIL_TABLE", genShoppingCartDetailTable.tableName);

// GSI access for ShoppingCart (query pending cart by userId)
const { region: genRegion, account: genAccount } = Stack.of(generateEnrollmentLambda);
generateEnrollmentLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [
      `arn:aws:dynamodb:${genRegion}:${genAccount}:table/v2ShoppingCart-*/index/*`,
    ],
  })
);

// ── removeEnrollmentV2 (resourceGroupName: "data") ────────────────────────────
// Soft-delete: enrollment + sessionDetails + shoppingCartDetail
const removeEnrollmentLambda = backend.removeEnrollmentFn.resources.lambda as LambdaFunction;

genEnrollmentTable.grantReadWriteData(removeEnrollmentLambda);
genSessionDetailTable.grantReadWriteData(removeEnrollmentLambda);
genShoppingCartDetailTable.grantReadWriteData(removeEnrollmentLambda);

// GSI queries on sessionDetails and shoppingCartDetail by enrollmentId
const { region: removeRegion, account: removeAccount } = Stack.of(removeEnrollmentLambda);
removeEnrollmentLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [
      `arn:aws:dynamodb:${removeRegion}:${removeAccount}:table/v2SessionDetail-*/index/*`,
      `arn:aws:dynamodb:${removeRegion}:${removeAccount}:table/v2ShoppingCartDetail-*/index/*`,
    ],
  })
);

removeEnrollmentLambda.addEnvironment("ENROLLMENT_TABLE",           genEnrollmentTable.tableName);
removeEnrollmentLambda.addEnvironment("SESSION_DETAIL_TABLE",       genSessionDetailTable.tableName);
removeEnrollmentLambda.addEnvironment("SHOPPING_CART_DETAIL_TABLE", genShoppingCartDetailTable.tableName);

// ── mercadopagoStart (resourceGroupName: "data") ──────────────────────────────
// Crea una preferencia de pago en MercadoPago y registra transacción PENDING_MP.
// Secret: miniswimmer/mercadopago-production → { access_token, access_token_test }
const mercadopagoStartLambda = backend.mercadopagoStartFn.resources.lambda as LambdaFunction;

paymentTransactionsTable.grantWriteData(mercadopagoStartLambda);

const { region: mpStartRegion, account: mpStartAccount } = Stack.of(mercadopagoStartLambda);
mercadopagoStartLambda.addToRolePolicy(
  new PolicyStatement({
    actions:   ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:${mpStartRegion}:${mpStartAccount}:secret:miniswimmer/mercadopago-production*`],
  })
);

mercadopagoStartLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE", paymentTransactionsTable.tableName);
mercadopagoStartLambda.addEnvironment("MP_SECRET_NAME",             "miniswimmer/mercadopago-production");
mercadopagoStartLambda.addEnvironment("MP_ENV",                     process.env.MP_ENV ?? "test");
mercadopagoStartLambda.addEnvironment(
  "FRONTEND_URL",
  process.env.FRONTEND_URL ?? "http://localhost:5173"
);

// ── mercadopagoStatus (resourceGroupName: "data") ─────────────────────────────
// Consulta el estado de un pago por payment_id (retornado por MercadoPago en la back_url).
const mercadopagoStatusLambda = backend.mercadopagoStatusFn.resources.lambda as LambdaFunction;

const { region: mpStatusRegion, account: mpStatusAccount } = Stack.of(mercadopagoStatusLambda);
mercadopagoStatusLambda.addToRolePolicy(
  new PolicyStatement({
    actions:   ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:${mpStatusRegion}:${mpStatusAccount}:secret:miniswimmer/mercadopago-production*`],
  })
);

mercadopagoStatusLambda.addEnvironment("MP_SECRET_NAME", "miniswimmer/mercadopago-production");
mercadopagoStatusLambda.addEnvironment("MP_ENV",         process.env.MP_ENV ?? "test");
