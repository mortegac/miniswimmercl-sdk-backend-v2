import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminCreateUserCommand,
  MessageActionType,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});
const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const USER_POOL_ID = process.env.USER_POOL_ID!;
const USERS_TABLE  = process.env.USERS_TABLE!;

export const handler = async (event: any) => {
  const fieldName: string = event?.info?.fieldName ?? event?.fieldName ?? "";
  const args = event?.arguments ?? event;

  switch (fieldName) {

    // ── Cambiar contraseña ────────────────────────────────────────────────────
    case "v2CognitoSetPassword": {
      await cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: USER_POOL_ID,
          Username: args.email,
          Password: args.password,
          Permanent: args.permanent ?? true,
        })
      );
      return true;
    }

    // ── Habilitar / Deshabilitar usuario ─────────────────────────────────────
    case "v2CognitoSetStatus": {
      if (args.enabled) {
        await cognitoClient.send(
          new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: args.email })
        );
      } else {
        await cognitoClient.send(
          new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: args.email })
        );
      }
      return true;
    }

    // ── Crear usuario en Cognito + DynamoDB ───────────────────────────────────
    case "v2CognitoCreateUser": {
      // 1. Crear en Cognito
      await cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: args.email,
          UserAttributes: [
            { Name: "email",          Value: args.email },
            { Name: "email_verified", Value: "true" },
            { Name: "name",           Value: args.name ?? "" },
          ],
          TemporaryPassword: args.temporaryPassword,
          MessageAction: MessageActionType.SUPPRESS, // no enviar email automático de Cognito
        })
      );

      // 2. Crear registro en DynamoDB (v2Users)
      const now = new Date().toISOString();
      await dynamoClient.send(
        new PutItemCommand({
          TableName: USERS_TABLE,
          ConditionExpression: "attribute_not_exists(id)", // no sobreescribir si ya existe
          Item: {
            id:              { S: args.email },
            email:           { S: args.email },
            name:            { S: args.name ?? "" },
            contactPhone:    { S: args.contactPhone ?? "" },
            roleId:          { S: args.roleId ?? "" },
            isEmployed:      { BOOL: args.isEmployed ?? false },
            isAcademyStudent:{ BOOL: false },
            validated:       { BOOL: true },
            firstContact:    { BOOL: false },
            ig:              { S: "" },
            country:         { S: "CHILE" },
            createdAt:       { S: now },
            updatedAt:       { S: now },
            __typename:      { S: "v2Users" },
          },
        })
      );

      return {
        email:   args.email,
        name:    args.name ?? "",
        roleId:  args.roleId ?? "",
      };
    }

    default:
      throw new Error(`cognitoUserMgmt: unknown field '${fieldName}'`);
  }
};
