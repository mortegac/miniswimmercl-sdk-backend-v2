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
const SHOPPING_CART_TABLE        = process.env.SHOPPING_CART_TABLE!;
const SHOPPING_CART_DETAIL_TABLE = process.env.SHOPPING_CART_DETAIL_TABLE!;
const ENROLLMENT_TABLE           = process.env.ENROLLMENT_TABLE!;
const ACADEMY_ENROLLMENT_TABLE   = process.env.ACADEMY_ENROLLMENT_TABLE!;
const PRIVATE_ENROLLMENT_TABLE   = process.env.PRIVATE_ENROLLMENT_TABLE!;

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
// Flujo normal: el usuario completa el pago y Webpay redirige con token_ws.
// Este Lambda confirma la transacción y actualiza cart + enrollments si fue AUTORIZADA.
export const handler: Handler = async (event) => {
  const { token } = event.arguments as { token: string };

  if (!token) throw new Error("token is required");

  // 1. Confirmar transacción con Transbank
  let commitResponse: Record<string, unknown>;
  try {
    commitResponse = await tbTransaction.commit(token) as Record<string, unknown>;
    console.log("[webpayCommit] commitResponse:", JSON.stringify(commitResponse));
  } catch (err) {
    console.error("[webpayCommit] Transbank commit failed", err);
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

  if (!txRecord) {
    console.error("[webpayCommit] No transaction found for token:", token);
    return buildTransactionResult(commitResponse);
  }

  const cardDetail = commitResponse.card_detail as Record<string, unknown> | undefined;
  const now = new Date().toISOString();

  // 3. Actualizar v2PaymentTransactions con todos los campos del commit
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
        ":s":   commitResponse.status              ?? txRecord.status,
        ":bo":  commitResponse.buy_order           ?? txRecord.buy_order,
        ":sid": commitResponse.session_id          ?? txRecord.session_id,
        ":cn":  cardDetail?.card_number            ?? txRecord.card_number,
        ":cd":  cardDetail                         ?? txRecord.card_detail,
        ":td":  commitResponse.transaction_date    ?? txRecord.transaction_date,
        ":ad":  commitResponse.accounting_date     ?? txRecord.accounting_date,
        ":in":  commitResponse.installments_number ?? txRecord.installments_number,
        ":ia":  commitResponse.installments_amount ?? txRecord.installments_amount,
        ":ptc": commitResponse.payment_type_code   ?? txRecord.payment_type_code,
        ":ac":  commitResponse.authorization_code  ?? txRecord.authorization_code,
        ":rc":  commitResponse.response_code       ?? txRecord.response_code,
        ":vci": commitResponse.vci                 ?? txRecord.vci,
        ":ua":  now,
      },
    })
  );

  // 4. Si fue AUTORIZADA — actualizar cart y enrollments
  const isApproved =
    commitResponse.status === "AUTHORIZED" &&
    (commitResponse.response_code === 0 || commitResponse.response_code === "0");

  if (!isApproved) {
    console.log(`[webpayCommit] NOT approved — status: ${commitResponse.status}, response_code: ${commitResponse.response_code}`);
    return buildTransactionResult(commitResponse);
  }

  const shoppingCartId = txRecord.shoppingCartId as string;

  // 4a. Actualizar cart a AUTHORIZED
  await ddb.send(
    new UpdateCommand({
      TableName: SHOPPING_CART_TABLE,
      Key: { id: shoppingCartId },
      UpdateExpression: "SET #s = :s, updatedAt = :ua",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "AUTHORIZED", ":ua": now },
    })
  );

  // 4b. Obtener items del carrito (GSI byCartId — evita Scan sobre toda la tabla)
  const detailResult = await ddb.send(
    new QueryCommand({
      TableName: SHOPPING_CART_DETAIL_TABLE,
      IndexName: "byCartId",
      KeyConditionExpression: "cartId = :cid",
      ExpressionAttributeValues: { ":cid": shoppingCartId },
    })
  );
  const details = (detailResult.Items ?? []) as Record<string, unknown>[];

  // 4c. Marcar enrollments como pagados — en paralelo
  const enrollmentUpdates = details.flatMap(detail => {
    const updates: Promise<unknown>[] = [];

    if (detail.enrollmentId) {
      updates.push(ddb.send(new UpdateCommand({
        TableName: ENROLLMENT_TABLE,
        Key: { id: detail.enrollmentId as string },
        UpdateExpression: "SET wasPaid = :p, updatedAt = :ua",
        ExpressionAttributeValues: { ":p": true, ":ua": now },
      })));
    }
    if (detail.academyEnrollmentId) {
      updates.push(ddb.send(new UpdateCommand({
        TableName: ACADEMY_ENROLLMENT_TABLE,
        Key: { id: detail.academyEnrollmentId as string },
        UpdateExpression: "SET wasPaid = :p, updatedAt = :ua",
        ExpressionAttributeValues: { ":p": true, ":ua": now },
      })));
    }
    if (detail.privateEnrollmentId) {
      updates.push(ddb.send(new UpdateCommand({
        TableName: PRIVATE_ENROLLMENT_TABLE,
        Key: { id: detail.privateEnrollmentId as string },
        UpdateExpression: "SET wasPaid = :p, updatedAt = :ua",
        ExpressionAttributeValues: { ":p": true, ":ua": now },
      })));
    }

    return updates;
  });

  await Promise.all(enrollmentUpdates);
  console.log(`[webpayCommit] AUTHORIZED — cart ${shoppingCartId}, ${enrollmentUpdates.length} enrollment(s) updated`);

  return buildTransactionResult(commitResponse);
};
