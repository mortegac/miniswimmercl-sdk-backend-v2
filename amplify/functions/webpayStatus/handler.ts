import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createTbTransaction } from "../shared/transbank";

// ─── Config ───────────────────────────────────────────────────────────────────
const PAYMENT_TRANSACTIONS_TABLE = process.env.PAYMENT_TRANSACTIONS_TABLE!;
const SHOPPING_CART_TABLE        = process.env.SHOPPING_CART_TABLE!;
const TRANSBANK_SECRET_NAME      = process.env.TRANSBANK_SECRET_NAME!;

// ─── Secrets Manager client (singleton) ──────────────────────────────────────
const secretsClient = new SecretsManagerClient({});
let tbTransaction: ReturnType<typeof createTbTransaction> | undefined;

async function getTbTransaction() {
  if (tbTransaction) return tbTransaction;
  const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: TRANSBANK_SECRET_NAME }));
  const { commerce_code, api_key, environment } = JSON.parse(res.SecretString!);
  tbTransaction = createTbTransaction(commerce_code, api_key, environment);
  return tbTransaction;
};

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
// Usado en Flow 3 (cancelación — TBK_TOKEN presente) y recuperación de errores.
// Registra el estado de cancelación en transaction + cierra el cart.
export const handler: Handler = async (event) => {
  const { token } = event.arguments as { token: string };

  if (!token) throw new Error("token is required");

  // 1. Consultar estado en Transbank
  const tbTransaction = await getTbTransaction();
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
      KeyConditionExpression: "#token = :t",
      ExpressionAttributeNames: { "#token": "token" },
      ExpressionAttributeValues: { ":t": token },
      Limit: 1,
    })
  );
  const txRecord = queryResult.Items?.[0] as Record<string, unknown> | undefined;

  // 3. Sincronizar estado de Transbank en DB
  if (txRecord) {
    const cardDetail = statusResponse.card_detail as Record<string, unknown> | undefined;
    const now = new Date().toISOString();

    // Para transacciones canceladas Transbank omite varios campos (vci, installments, etc.)
    // → construir UpdateExpression dinámicamente para no referenciar aliases sin valor
    const optionalFields: Array<[string, unknown, string]> = [
      ["buy_order",           statusResponse.buy_order           ?? txRecord.buy_order,           ":bo" ],
      ["session_id",          statusResponse.session_id          ?? txRecord.session_id,          ":sid"],
      ["card_number",         cardDetail?.card_number            ?? txRecord.card_number,         ":cn" ],
      ["card_detail",         cardDetail                         ?? txRecord.card_detail,         ":cd" ],
      ["transaction_date",    statusResponse.transaction_date    ?? txRecord.transaction_date,    ":td" ],
      ["accounting_date",     statusResponse.accounting_date     ?? txRecord.accounting_date,     ":ad" ],
      ["installments_number", statusResponse.installments_number ?? txRecord.installments_number, ":in" ],
      ["installments_amount", statusResponse.installments_amount ?? txRecord.installments_amount, ":ia" ],
      ["payment_type_code",   statusResponse.payment_type_code   ?? txRecord.payment_type_code,   ":ptc"],
      ["authorization_code",  statusResponse.authorization_code  ?? txRecord.authorization_code,  ":ac" ],
      ["response_code",       statusResponse.response_code       ?? txRecord.response_code,       ":rc" ],
      ["vci",                 statusResponse.vci                 ?? txRecord.vci,                 ":vci"],
    ];

    const setParts = ["#s = :s", "updatedAt = :ua"];
    const exprValues: Record<string, unknown> = {
      ":s":  statusResponse.status ?? "CANCELLED",
      ":ua": now,
    };

    for (const [field, value, alias] of optionalFields) {
      if (value !== undefined) {
        setParts.push(`${field} = ${alias}`);
        exprValues[alias] = value;
      }
    }

    await ddb.send(
      new UpdateCommand({
        TableName: PAYMENT_TRANSACTIONS_TABLE,
        Key: { id: txRecord.id as string },
        UpdateExpression: `SET ${setParts.join(", ")}`,
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: exprValues,
      })
    );

    // Si Transbank aprueba la transacción también actualizar el ShoppingCart
    const isApproved =
      statusResponse.status === "AUTHORIZED" &&
      (statusResponse.response_code === 0 || statusResponse.response_code === "0");

    if (isApproved) {
      const shoppingCartId = txRecord.shoppingCartId as string | undefined;
      if (shoppingCartId) {
        await ddb.send(
          new UpdateCommand({
            TableName: SHOPPING_CART_TABLE,
            Key: { id: shoppingCartId },
            UpdateExpression: "SET #s = :s, updatedAt = :ua",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":s": "AUTHORIZED", ":ua": now },
          })
        );
        console.log("[webpayStatus] ShoppingCart actualizado a AUTHORIZED:", shoppingCartId);
      }
    }
  }

  return buildTransactionResult(statusResponse);
};
