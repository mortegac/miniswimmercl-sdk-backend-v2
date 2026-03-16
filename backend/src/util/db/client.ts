/**
 * Cliente DynamoDB — SDK v3 con DocumentClient.
 * Punto central de acceso a DynamoDB para todos los repositorios.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  type QueryCommandInput,
  type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";

// ─── Client singleton ─────────────────────────────────────────────────────────

const dynamoClient = new DynamoDBClient({});

export const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = process.env["TABLE_NAME"]!;

// ─── Query params type (sin TableName — se inyecta en cada operación) ─────────

export type QueryParams = Omit<QueryCommandInput, "TableName" | "Limit" | "ExclusiveStartKey">;

// ─── Key helpers ──────────────────────────────────────────────────────────────

export const entityKeys = {
  customer: {
    pk: (id: string) => `CUSTOMER#${id}`,
    sk: () => "METADATA",
    gsi1pk: (status: string) => `CUSTOMER#${status}`,
    gsi1sk: (createdAt: string) => createdAt,
  },
  user: {
    pk: (id: string) => `USER#${id}`,
    sk: () => "METADATA",
    gsi1pk: (role: string) => `USER#${role}`,
    gsi1sk: (createdAt: string) => createdAt,
    gsi2pk: (cognitoId: string) => `COGNITO#${cognitoId}`,
  },
  webform: {
    pk: (id: string) => `WEBFORM#${id}`,
    sk: () => "METADATA",
    customerPk: (customerId: string) => `CUSTOMER#${customerId}`,
    customerSk: (createdAt: string, id: string) => `WEBFORM#${createdAt}#${id}`,
    gsi1pk: (type: string, status: string) => `WEBFORM#${type}#${status}`,
    gsi1sk: (createdAt: string) => createdAt,
    gsi2pk: (userId: string) => `USER#${userId}`,
    gsi2sk: (createdAt: string) => createdAt,
  },
} as const;

// ─── Generic operations ───────────────────────────────────────────────────────

export async function getItem<T>(pk: string, sk: string): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: pk, SK: sk } })
  );
  return (result.Item as T) ?? null;
}

export async function putItem<T extends Record<string, unknown>>(item: T): Promise<T> {
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

export async function updateItem(
  pk: string,
  sk: string,
  updates: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const entries = Object.entries(updates);
  const expressionParts: string[] = [];
  const attributeNames: Record<string, string> = {};
  const attributeValues: Record<string, unknown> = {};

  entries.forEach(([key, value]) => {
    expressionParts.push(`#${key} = :${key}`);
    attributeNames[`#${key}`] = key;
    attributeValues[`:${key}`] = value;
  });

  const params: UpdateCommandInput = {
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
    UpdateExpression: `SET ${expressionParts.join(", ")}`,
    ExpressionAttributeNames: attributeNames,
    ExpressionAttributeValues: attributeValues,
    ReturnValues: "ALL_NEW",
    ConditionExpression: "attribute_exists(PK)",
  };

  const result = await docClient.send(new UpdateCommand(params));
  return result.Attributes as Record<string, unknown>;
}

export async function deleteItem(pk: string, sk: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      ConditionExpression: "attribute_exists(PK)",
    })
  );
}

export async function queryItems<T>(
  params: Omit<QueryCommandInput, "TableName">
): Promise<{ items: T[]; nextToken?: string }> {
  const result = await docClient.send(
    new QueryCommand({ TableName: TABLE_NAME, ...params })
  );
  return {
    items: (result.Items ?? []) as T[],
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64")
      : undefined,
  };
}

export function decodeNextToken(
  nextToken?: string
): Record<string, unknown> | undefined {
  if (!nextToken) return undefined;
  return JSON.parse(Buffer.from(nextToken, "base64").toString("utf-8"));
}
