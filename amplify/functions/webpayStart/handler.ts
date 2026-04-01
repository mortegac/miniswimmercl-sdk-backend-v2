import type { Handler } from "aws-lambda";
import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { tbTransaction } from "../shared/transbank";

// ─── Config ───────────────────────────────────────────────────────────────────
const CORRELATIVES_TABLE         = process.env.CORRELATIVES_TABLE!;
const PAYMENT_TRANSACTIONS_TABLE = process.env.PAYMENT_TRANSACTIONS_TABLE!;
const RETURN_URL                 = process.env.WEBPAY_RETURN_URL!;

// ─── DynamoDB client (singleton) ──────────────────────────────────────────────
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Correlative id cache (warm-start optimization) ───────────────────────────
// Cold start: 1 Query al GSI byType. Warm start: skip — va directo al UpdateCommand.
let cachedCorrelativeId: string | undefined;

async function getNextBuyOrder(): Promise<number> {
  if (!cachedCorrelativeId) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: CORRELATIVES_TABLE,
        IndexName: "byType",
        KeyConditionExpression: "#t = :type",
        ExpressionAttributeNames: { "#t": "type" },
        ExpressionAttributeValues: { ":type": "ORDER_PAYMENTTRANSACTIONS" },
        Limit: 1,
      })
    );
    const item = result.Items?.[0];
    if (!item?.id) throw new Error("Correlative ORDER_PAYMENTTRANSACTIONS not found");
    cachedCorrelativeId = item.id as string;
  }

  const update = await ddb.send(
    new UpdateCommand({
      TableName: CORRELATIVES_TABLE,
      Key: { id: cachedCorrelativeId },
      UpdateExpression: "ADD correlative :inc",
      ExpressionAttributeValues: { ":inc": 1 },
      ReturnValues: "UPDATED_NEW",
    })
  );

  return update.Attributes!.correlative as number;
}

function getSantiagoDateParts() {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), year: get("year"), hour: get("hour") };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {
  const { amount, userId, glosa, cartId } = event.arguments as {
    amount: number;
    userId: string;
    glosa: string;
    cartId: string;
  };

  if (!cartId) throw new Error("cartId is required");
  if (!userId) throw new Error("userId is required");
  if (amount <= 0) throw new Error("amount must be positive");

  // 1. Atomic increment del correlativo (buy order)
  const buyOrder = await getNextBuyOrder();
  const sessionId = randomUUID();

  // 2. Crear transacción en Transbank
  let token: string;
  let url: string;
  try {
    const tbResponse = await tbTransaction.create(
      String(buyOrder),
      sessionId,
      Math.round(amount),
      RETURN_URL
    ) as { token: string; url: string };
    token = tbResponse.token;
    url   = tbResponse.url;
  } catch (err) {
    // El buyOrder queda con un hueco — aceptable vs. dejar datos inconsistentes
    console.error("[webpayStart] Transbank create failed — buyOrder:", buyOrder, err);
    throw new Error(`Transbank error: ${(err as Error).message}`);
  }

  // 3. Guardar transacción pendiente en DynamoDB
  const { day, month, year, hour } = getSantiagoDateParts();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: PAYMENT_TRANSACTIONS_TABLE,
      Item: {
        id: randomUUID(),
        __typename: "v2PaymentTransactions",
        createdAt: now,
        updatedAt: now,
        status: "PENDING",
        token,
        urlWebpay: url,
        amount,
        buy_order: String(buyOrder),
        session_id: sessionId,
        day, month, year, hour,
        glosa,
        hasRefund: false,
        usersId: userId,
        shoppingCartId: cartId,
      },
    })
  );

  return { token, url, orden: buyOrder };
};
