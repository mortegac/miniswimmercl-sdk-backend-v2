import type { AppSyncResolverHandler } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
  type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? "us-east-2",
});

const USER_POOL_ID = process.env.USER_POOL_ID!;

// Tipos que coinciden con el schema de AppSync
type Args = {
  limit?: number;
  nextToken?: string;
  filter?: string;       // Sintaxis Cognito: "email ^= \"admin\""
};

type CognitoUserItem = {
  sub: string;
  email: string;
  name: string | null;
  enabled: boolean;
  status: string;
  createdAt: string;
};

type Result = {
  users: CognitoUserItem[];
  nextToken: string | null;
};

function getAttr(attrs: AttributeType[] | undefined, name: string): string | null {
  return attrs?.find((a) => a.Name === name)?.Value ?? null;
}

function mapUser(user: UserType): CognitoUserItem {
  return {
    sub: getAttr(user.Attributes, "sub") ?? user.Username ?? "",
    email: getAttr(user.Attributes, "email") ?? "",
    name: getAttr(user.Attributes, "name"),
    enabled: user.Enabled ?? true,
    status: user.UserStatus ?? "UNKNOWN",
    createdAt: user.UserCreateDate?.toISOString() ?? "",
  };
}

export const handler: AppSyncResolverHandler<Args, Result> = async (event) => {
  const { limit = 60, nextToken, filter } = event.arguments;

  const command = new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Limit: limit,
    PaginationToken: nextToken ?? undefined,
    Filter: filter ?? undefined,
  });

  const result = await client.send(command);

  return {
    users: (result.Users ?? []).map(mapUser),
    nextToken: result.PaginationToken ?? null,
  };
};
