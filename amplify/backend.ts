import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaTarget } from "aws-cdk-lib/aws-events-targets";
import { Stack } from "aws-cdk-lib";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { postConfirmationFn } from "./functions/postConfirmation/resource";
import { listCognitoUsersFn } from "./functions/listCognitoUsers/resource";
import { dailyCleanupSessionsFn } from "./functions/dailyCleanupSessions/resource";
import { webpayStartFn } from "./functions/webpayStart/resource";
import { webpayCommitFn } from "./functions/webpayCommit/resource";
import { webpayStatusFn } from "./functions/webpayStatus/resource";
import { gmailSyncFn } from "./functions/gmailSync/resource";
import { gmailReplyFn } from "./functions/gmailReply/resource";
import { cognitoUserMgmtFn } from "./functions/cognitoUserMgmt/resource";

/**
 * V2 Backend - Amplify Gen 2
 *
 * Backend independiente del Gen 1. No interfiere con producción.
 *
 * Para desarrollo local:   npx ampx sandbox --profile miniswimmer
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
  gmailSyncFn,
  gmailReplyFn,
});

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

webpayStartLambda.addEnvironment("CORRELATIVES_TABLE", correlativesTable.tableName);
webpayStartLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE", paymentTransactionsTable.tableName);
webpayStartLambda.addEnvironment("TRANSBANK_ENV", "integration");
webpayStartLambda.addEnvironment("COMMERCE_CODE", "597055555532");
webpayStartLambda.addEnvironment("WEBPAY_API_KEY", "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C");
webpayStartLambda.addEnvironment("WEBPAY_RETURN_URL", "https://backoffice.miniswimmer.cl/pago/resultado");

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

webpayCommitLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE",  paymentTransactionsTable.tableName);
webpayCommitLambda.addEnvironment("SHOPPING_CART_TABLE",         shoppingCartTable.tableName);
webpayCommitLambda.addEnvironment("SHOPPING_CART_DETAIL_TABLE",  shoppingCartDetailTable.tableName);
webpayCommitLambda.addEnvironment("ENROLLMENT_TABLE",            enrollmentTable.tableName);
webpayCommitLambda.addEnvironment("ACADEMY_ENROLLMENT_TABLE",    academyEnrollmentTable.tableName);
webpayCommitLambda.addEnvironment("PRIVATE_ENROLLMENT_TABLE",    privateEnrollmentTable.tableName);
webpayCommitLambda.addEnvironment("TRANSBANK_ENV",   "integration");
webpayCommitLambda.addEnvironment("COMMERCE_CODE",   "597055555532");
webpayCommitLambda.addEnvironment("WEBPAY_API_KEY",  "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C");

// ── webpayStatus (resourceGroupName: "data") ──────────────────────────────────
// Status es solo para recuperación de errores — no actualiza cart ni enrollments
const webpayStatusLambda = backend.webpayStatusFn.resources.lambda as LambdaFunction;

paymentTransactionsTable.grantReadWriteData(webpayStatusLambda);

webpayStatusLambda.addEnvironment("PAYMENT_TRANSACTIONS_TABLE", paymentTransactionsTable.tableName);
webpayStatusLambda.addEnvironment("TRANSBANK_ENV",  "integration");
webpayStatusLambda.addEnvironment("COMMERCE_CODE",  "597055555532");
webpayStatusLambda.addEnvironment("WEBPAY_API_KEY", "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C");

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
