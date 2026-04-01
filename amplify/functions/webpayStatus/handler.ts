import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { tbTransaction } from "../shared/transbank";

// ─── Config ───────────────────────────────────────────────────────────────────
const PAYMENT_TRANSACTIONS_TABLE = process.env.PAYMENT_TRANSACTIONS_TABLE!;

// ─── DynamoDB client (singleton) ──────────────────────────────────────────────
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildTransactionResult(r: Record<string, unknown>) {
  const card = r.card_detail as Record<string, unknown> | undefined;
  return {
    status:              r.status              ?? null,
    buy_order:           r.buy_order           ?? null,
    session_id:          r.session_id          ?? null,
    amount:              r.amount              ?? null,
    transaction_date:    r.transaction_date    ?? null,
    accounting_date:     r.accounting_date     ?? null,
    authorization_code:  r.authorization_code  ?? null,
    payment_type_code:   r.payment_type_code   ?? null,
    response_code:       r.response_code       ?? null,
    installments_number: r.installments_number ?? null,
    installments_amount: r.installments_amount ?? null,
    vci:                 r.vci                 ?? null,
    card_number:         card?.card_number     ?? null,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
// Solo para RECUPERACIÓN de errores — disponible hasta 7 días después del create.
// El flujo normal usa webpayCommit para confirmar y actualizar cart/enrollments.
export const handler: Handler = async (event) => {
  const { token } = event.arguments as { token: string };

  if (!token) throw new Error("token is required");

  // 1. Consultar estado en Transbank
  let statusResponse: Record<string, unknown>;
  try {
    statusResponse = await tbTransaction.status(token) as Record<string, unknown>;
    console.log("[webpayStatus] statusResponse:", JSON.stringify(statusResponse));
  } catch (err) {
    console.error("[webpayStatus] Transbank status failed", err);
    throw new Error(`Transbank error: ${(err as Error).message}`);
  }

  // 2. Buscar el registro en DB por token (GSI byToken)
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: PAYMENT_TRANSACTIONS_TABLE,
      IndexName: "byToken",
      KeyConditionExpression: "token = :t",
      ExpressionAttributeValues: { ":t": token },
      Limit: 1,
    })
  );
  const txRecord = queryResult.Items?.[0] as Record<string, unknown> | undefined;

  // 3. Sincronizar estado de Transbank en DB
  if (txRecord) {
    const cardDetail = statusResponse.card_detail as Record<string, unknown> | undefined;
    const now = new Date().toISOString();

    await ddb.send(
      new UpdateCommand({
        TableName: PAYMENT_TRANSACTIONS_TABLE,
        Key: { id: txRecord.id as string },
        UpdateExpression: [
          "SET #s = :s",
          "buy_order = :bo",
          "session_id = :sid",
          "card_number = :cn",
          "card_detail = :cd",
          "transaction_date = :td",
          "accounting_date = :ad",
          "installments_number = :in",
          "installments_amount = :ia",
          "payment_type_code = :ptc",
          "authorization_code = :ac",
          "response_code = :rc",
          "vci = :vci",
          "updatedAt = :ua",
        ].join(", "),
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s":   statusResponse.status              ?? txRecord.status,
          ":bo":  statusResponse.buy_order           ?? txRecord.buy_order,
          ":sid": statusResponse.session_id          ?? txRecord.session_id,
          ":cn":  cardDetail?.card_number            ?? txRecord.card_number,
          ":cd":  cardDetail                         ?? txRecord.card_detail,
          ":td":  statusResponse.transaction_date    ?? txRecord.transaction_date,
          ":ad":  statusResponse.accounting_date     ?? txRecord.accounting_date,
          ":in":  statusResponse.installments_number ?? txRecord.installments_number,
          ":ia":  statusResponse.installments_amount ?? txRecord.installments_amount,
          ":ptc": statusResponse.payment_type_code   ?? txRecord.payment_type_code,
          ":ac":  statusResponse.authorization_code  ?? txRecord.authorization_code,
          ":rc":  statusResponse.response_code       ?? txRecord.response_code,
          ":vci": statusResponse.vci                 ?? txRecord.vci,
          ":ua":  now,
        },
      })
    );
  }

  return buildTransactionResult(statusResponse);
};
