import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

// ─── Config ───────────────────────────────────────────────────────────────────
const ENROLLMENT_TABLE           = process.env.ENROLLMENT_TABLE!;
const SESSION_DETAIL_TABLE       = process.env.SESSION_DETAIL_TABLE!;
const SHOPPING_CART_DETAIL_TABLE = process.env.SHOPPING_CART_DETAIL_TABLE!;

// ─── DynamoDB client (singleton) ──────────────────────────────────────────────
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Handler ──────────────────────────────────────────────────────────────────
// Soft-delete: marca el enrollment + sus SessionDetails + su ShoppingCartDetail.
// No elimina registros de DynamoDB para preservar auditoría.
export const handler: Handler = async (event) => {
  const { enrollId, employeeId } = event.arguments as {
    enrollId:   string;
    employeeId: string;
  };

  if (!enrollId)   throw new Error("enrollId is required");
  if (!employeeId) throw new Error("employeeId is required");

  const now = new Date().toISOString();

  // 1. Soft-delete del enrollment
  await ddb.send(
    new UpdateCommand({
      TableName: ENROLLMENT_TABLE,
      Key: { id: enrollId },
      UpdateExpression: "SET wasDeleted = :d, updatedAt = :ua",
      ExpressionAttributeValues: { ":d": true, ":ua": now },
    })
  );

  // 2. Marcar SessionDetails como DELETED (GSI auto-generado por Amplify Gen 2)
  const sessionRes = await ddb.send(
    new QueryCommand({
      TableName: SESSION_DETAIL_TABLE,
      IndexName: "gsi-v2Enrollment.sessionDetails",
      KeyConditionExpression: "enrollmentId = :eid",
      ExpressionAttributeValues: { ":eid": enrollId },
    })
  );

  const sessionUpdates = (sessionRes.Items ?? []).map((item) =>
    ddb.send(
      new UpdateCommand({
        TableName: SESSION_DETAIL_TABLE,
        Key: { id: item.id as string },
        UpdateExpression: "SET #s = :s, updatedAt = :ua",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": "DELETED", ":ua": now },
      })
    )
  );

  // 3. Marcar ShoppingCartDetail como wasDeleted (GSI auto-generado por Amplify Gen 2)
  const cartDetailRes = await ddb.send(
    new QueryCommand({
      TableName: SHOPPING_CART_DETAIL_TABLE,
      IndexName: "gsi-v2Enrollment.shoppingCartDetail",
      KeyConditionExpression: "enrollmentId = :eid",
      ExpressionAttributeValues: { ":eid": enrollId },
    })
  );

  const cartDetailUpdates = (cartDetailRes.Items ?? []).map((item) =>
    ddb.send(
      new UpdateCommand({
        TableName: SHOPPING_CART_DETAIL_TABLE,
        Key: { id: item.id as string },
        UpdateExpression: "SET wasDeleted = :d, updatedAt = :ua",
        ExpressionAttributeValues: { ":d": true, ":ua": now },
      })
    )
  );

  await Promise.all([...sessionUpdates, ...cartDetailUpdates]);

  console.log(
    `[removeEnrollment] OK — enrollId=${enrollId}, sessions=${sessionRes.Items?.length ?? 0}, cartDetails=${cartDetailRes.Items?.length ?? 0}, by=${employeeId}`
  );

  return true;
};
