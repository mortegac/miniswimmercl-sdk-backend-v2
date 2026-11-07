import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

// ─── Config ───────────────────────────────────────────────────────────────────
const PAYMENT_TRANSACTIONS_TABLE = process.env.PAYMENT_TRANSACTIONS_TABLE!;

// ─── DynamoDB client (singleton) ──────────────────────────────────────────────
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Handler ──────────────────────────────────────────────────────────────────
// Flujo 2 (timeout >10 min en Webpay): Transbank redirige sin token pero con
// TBK_ORDEN_COMPRA. Lo usamos para localizar la transacción PENDING y marcarla
// como TIMEOUT. TBK_ORDEN_COMPRA puede no estar presente — se valida antes de llamar.
export const handler: Handler = async (event) => {
  const { ordenCompra } = event.arguments as { ordenCompra?: string };

  // TBK_ORDEN_COMPRA no siempre viene en la respuesta de Webpay — manejar ausencia
  if (!ordenCompra || ordenCompra.trim() === "") {
    console.log("[webpayTimeout] No ordenCompra provided — cannot identify transaction");
    return { updated: false, buy_order: null };
  }

  console.log(`[webpayTimeout] Looking for PENDING transaction with buy_order: ${ordenCompra}`);

  // Buscar transacción PENDING por buy_order usando GSI byBuyOrder
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: PAYMENT_TRANSACTIONS_TABLE,
      IndexName: "byBuyOrder",
      KeyConditionExpression: "buy_order = :bo",
      FilterExpression: "#s = :pending",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":bo":      ordenCompra,
        ":pending": "PENDING",
      },
      Limit: 1,
    })
  );

  const txRecord = queryResult.Items?.[0] as Record<string, unknown> | undefined;

  if (!txRecord) {
    console.log(`[webpayTimeout] No PENDING transaction found for buy_order: ${ordenCompra}`);
    return { updated: false, buy_order: ordenCompra };
  }

  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: PAYMENT_TRANSACTIONS_TABLE,
      Key: { id: txRecord.id as string },
      UpdateExpression: "SET #s = :s, updatedAt = :ua",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "TIMEOUT", ":ua": now },
    })
  );

  console.log(`[webpayTimeout] Transaction ${txRecord.id} marked as TIMEOUT for buy_order: ${ordenCompra}`);
  return { updated: true, buy_order: ordenCompra };
};
