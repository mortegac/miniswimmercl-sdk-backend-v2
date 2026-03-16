import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminDisableUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { RepositoryFactory } from "@db/RepositoryFactory";
import { throwError } from "@error";
import { logger } from "@log";
import { entityKeys, getItem } from "@db/client";
import type { User, UserRole, CreateUserInput, UpdateUserInput } from "../../types/models";
import type { AppSyncEvent, ListFilter, Connection } from "../../types/appsync";

// ─── Cognito client ───────────────────────────────────────────────────────────

const cognitoClient = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env["USER_POOL_ID"]!;

// ─── DynamoDB record type ─────────────────────────────────────────────────────

type UserRecord = User & {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK?: string;
  GSI2SK?: string;
  entityType: "USER";
};

// ─── Repository ───────────────────────────────────────────────────────────────

const userRepo = RepositoryFactory<User, UserRecord, CreateUserInput, UpdateUserInput>({
  entityName: "User",
  keys: entityKeys.user,

  toRecord: (input, id, now, _createdBy) => ({
    PK: entityKeys.user.pk(id),
    SK: entityKeys.user.sk(),
    GSI1PK: entityKeys.user.gsi1pk(input.role),
    GSI1SK: entityKeys.user.gsi1sk(now),
    entityType: "USER",
    id,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    role: input.role,
    phone: input.phone,
    status: "PENDING_VERIFICATION" as const,
    cognitoId: "", // se rellena post-Cognito
    createdAt: now,
    updatedAt: now,
  }),

  fromRecord: ({ PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g1s, GSI2PK: _g2, GSI2SK: _g2s, entityType: _et, ...domain }) =>
    domain as User,

  buildUpdatePayload: (current, input, now) => {
    const { id: _id, role, ...rest } = input;
    const payload: Record<string, unknown> = { ...rest, updatedAt: now };
    if (role && role !== current.role) {
      payload["role"] = role;
      payload["GSI1PK"] = entityKeys.user.gsi1pk(role);
    }
    return payload;
  },
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function getUser(
  event: AppSyncEvent<{ id: string }>
): Promise<User | null> {
  return userRepo.getById(event.arguments.id);
}

export async function getCurrentUser(
  event: AppSyncEvent<Record<never, never>>
): Promise<User | null> {
  const cognitoId = event.identity.sub;
  const result = await userRepo.query({
    IndexName: "GSI2",
    KeyConditionExpression: "GSI2PK = :cognitoId",
    ExpressionAttributeValues: { ":cognitoId": entityKeys.user.gsi2pk(cognitoId) },
    limit: 1,
  });
  return result.items[0] ?? null;
}

export async function listUsers(
  event: AppSyncEvent<{ filter?: ListFilter }>
): Promise<Connection<User>> {
  const { filter } = event.arguments;
  const role = filter?.status ?? "ADMIN";

  return userRepo.query({
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :gsi1pk",
    ExpressionAttributeValues: { ":gsi1pk": entityKeys.user.gsi1pk(role) },
    ScanIndexForward: false,
    limit: filter?.limit ?? 20,
    nextToken: filter?.nextToken,
  });
}

export async function createUser(
  event: AppSyncEvent<{ input: CreateUserInput }>
): Promise<User> {
  const { input } = event.arguments;
  const now = new Date().toISOString();
  const { ulid } = await import("ulid");
  const id = ulid();

  try {
    logger.info("Creating Cognito user", { email: input.email, role: input.role });

    // 1. Crear en Cognito
    const cognitoResult = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: input.email,
        TemporaryPassword: input.temporaryPassword,
        UserAttributes: [
          { Name: "email", Value: input.email },
          { Name: "given_name", Value: input.firstName },
          { Name: "family_name", Value: input.lastName },
          { Name: "email_verified", Value: "true" },
          { Name: "custom:role", Value: input.role },
        ],
        MessageAction: "SUPPRESS",
      })
    );

    const cognitoId = cognitoResult.User!.Username!;

    // 2. Asignar grupo
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: cognitoId,
        GroupName: input.role,
      })
    );

    // 3. Guardar en DynamoDB con cognitoId real
    const { putItem } = await import("@db/client");
    const record: UserRecord = {
      PK: entityKeys.user.pk(id),
      SK: entityKeys.user.sk(),
      GSI1PK: entityKeys.user.gsi1pk(input.role),
      GSI1SK: entityKeys.user.gsi1sk(now),
      GSI2PK: entityKeys.user.gsi2pk(cognitoId),
      GSI2SK: now,
      entityType: "USER",
      id,
      cognitoId,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: "PENDING_VERIFICATION",
      phone: input.phone,
      createdAt: now,
      updatedAt: now,
    };

    await putItem(record);
    logger.info("User created successfully", { id, cognitoId });

    const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g1s, GSI2PK: _g2, GSI2SK: _g2s, entityType: _et, ...domain } = record;
    return domain as User;
  } catch (error) {
    throw throwError("User could not be created", error);
  }
}

export async function updateUser(
  event: AppSyncEvent<{ input: UpdateUserInput }>
): Promise<User> {
  const { input } = event.arguments;

  // Si cambia el rol, sincronizar con Cognito
  if (input.role) {
    const record = await getItem<UserRecord>(
      entityKeys.user.pk(input.id),
      entityKeys.user.sk()
    );
    if (!record) throwError(`User ${input.id} not found`);

    if (input.role !== record!.role) {
      logger.info("Syncing role change to Cognito", { userId: input.id, newRole: input.role });
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: USER_POOL_ID,
          Username: record!.cognitoId,
          UserAttributes: [{ Name: "custom:role", Value: input.role }],
        })
      );
      await cognitoClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username: record!.cognitoId,
          GroupName: input.role,
        })
      );
    }
  }

  return userRepo.update(input);
}

export async function deactivateUser(
  event: AppSyncEvent<{ id: string }>
): Promise<User> {
  const { id } = event.arguments;
  const record = await getItem<UserRecord>(entityKeys.user.pk(id), entityKeys.user.sk());
  if (!record) throwError(`User ${id} not found`);

  logger.info("Disabling Cognito user", { cognitoId: record!.cognitoId });
  await cognitoClient.send(
    new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: record!.cognitoId,
    })
  );

  return userRepo.update({ id, status: "INACTIVE" });
}
