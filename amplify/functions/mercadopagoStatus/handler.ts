import type { Handler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// ─── Config ───────────────────────────────────────────────────────────────────
const MP_SECRET_NAME             = process.env.MP_SECRET_NAME!;
const PAYMENT_TRANSACTIONS_TABLE = process.env.PAYMENT_TRANSACTIONS_TABLE!;
const SHOPPING_CART_TABLE        = process.env.SHOPPING_CART_TABLE!;
const SHOPPING_CART_DETAIL_TABLE = process.env.SHOPPING_CART_DETAIL_TABLE!;
const ENROLLMENT_TABLE           = process.env.ENROLLMENT_TABLE!;
const ACADEMY_ENROLLMENT_TABLE   = process.env.ACADEMY_ENROLLMENT_TABLE!;
const PRIVATE_ENROLLMENT_TABLE   = process.env.PRIVATE_ENROLLMENT_TABLE!;

// ─── Clients (singletons) ─────────────────────────────────────────────────────
const secretsClient = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

let mpCredentials: { access_token: string; access_token_test: string } | undefined;

async function getMpAccessToken(): Promise<string> {
  if (!mpCredentials) {
    const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: MP_SECRET_NAME }));
    mpCredentials = JSON.parse(res.SecretString!) as typeof mpCredentials;
  }
  const isTest = process.env.MP_ENV !== "production";
  return isTest ? mpCredentials!.access_token_test : mpCredentials!.access_token;
}

// ─── MP payment API response ──────────────────────────────────────────────────
interface MpPaymentResponse {
  id:                 number;
  status:             string;
  status_detail:      string;
  transaction_amount: number;
  description:        string;
  external_reference: string;
  payer:              { email?: string };
  payment_method_id:  string;
  date_approved:      string | null;
  card?:              { last_four_digits?: string };
  order?:             { id?: number };
}

/**
 * Localiza la transacción PENDING_MP asociada al pago:
 * 1. merchant_order → preference_id → GSI byToken (token = preferenceId)
 * 2. Fallback: scan por shoppingCartId = external_reference
 */
async function findTransaction(
  payment: MpPaymentResponse,
  accessToken: string
): Promise<Record<string, unknown> | undefined> {
  if (payment.order?.id) {
    try {
      const res = await fetch(`https://api.mercadopago.com/merchant_orders/${payment.order.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const order = (await res.json()) as { preference_id?: string };
        if (order.preference_id) {
          const q = await ddb.send(
            new QueryCommand({
              TableName: PAYMENT_TRANSACTIONS_TABLE,
              IndexName: "byToken",
              KeyConditionExpression: "#t = :t",
              ExpressionAttributeNames: { "#t": "token" },
              ExpressionAttributeValues: { ":t": order.preference_id },
              Limit: 1,
            })
          );
          if (q.Items?.[0]) return q.Items[0];
        }
      }
    } catch (err) {
      console.warn("[mercadopagoStatus] merchant_order lookup failed", err);
    }
  }

  // ponytail: scan con filtro — tabla chica (~4k); si crece, agregar GSI byShoppingCartId
  if (payment.external_reference) {
    const scan = await ddb.send(
      new ScanCommand({
        TableName: PAYMENT_TRANSACTIONS_TABLE,
        FilterExpression: "shoppingCartId = :c",
        ExpressionAttributeValues: { ":c": payment.external_reference },
      })
    );
    const items = (scan.Items ?? []) as Record<string, unknown>[];
    return items.find((i) => i.status === "PENDING_MP") ?? items[0];
  }
  return undefined;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {
  const { paymentId } = event.arguments as { paymentId: string };

  if (!paymentId) throw new Error("paymentId is required");

  const accessToken = await getMpAccessToken();

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`MercadoPago payments API error ${response.status} for paymentId ${paymentId}: ${errorBody}`);
  }

  const payment = (await response.json()) as MpPaymentResponse;
  const isApproved = payment.status === "approved";
  const now = new Date().toISOString();

  console.log("[mercadopagoStatus] paymentId:", paymentId, "status:", payment.status, "cart:", payment.external_reference);

  // ── Commit en DB: transacción, carro y enrollments (espejo de webpayCommit) ──
  const txRecord = await findTransaction(payment, accessToken);

  if (txRecord) {
    await ddb.send(
      new UpdateCommand({
        TableName: PAYMENT_TRANSACTIONS_TABLE,
        Key: { id: txRecord.id as string },
        UpdateExpression: [
          "SET #s = :s",
          "paymentProvider = :pp",
          "authorization_code = :ac",
          "transaction_date = :td",
          "response_code = :rc",
          "card_number = :cn",
          "payment_type_code = :ptc",
          "updatedAt = :ua",
        ].join(", "),
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s":   isApproved ? "AUTHORIZED" : payment.status.toUpperCase(),
          ":pp":  "MERCADOPAGO",
          ":ac":  String(payment.id),
          ":td":  payment.date_approved ?? now,
          ":rc":  isApproved ? "0" : payment.status_detail,
          ":cn":  payment.card?.last_four_digits ?? ((txRecord.card_number as string) ?? " "),
          ":ptc": payment.payment_method_id ?? " ",
          ":ua":  now,
        },
      })
    );
  } else {
    console.warn("[mercadopagoStatus] No se encontró transacción para el pago", paymentId);
  }

  if (isApproved) {
    const shoppingCartId = (txRecord?.shoppingCartId as string) || payment.external_reference;

    if (shoppingCartId) {
      // v2ShoppingCart → AUTHORIZED
      await ddb.send(
        new UpdateCommand({
          TableName: SHOPPING_CART_TABLE,
          Key: { id: shoppingCartId },
          UpdateExpression: "SET #s = :s, updatedAt = :ua",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":s": "AUTHORIZED", ":ua": now },
        })
      );

      // v2ShoppingCartDetail (GSI byCartId) → marcar enrollments pagados
      const detailResult = await ddb.send(
        new QueryCommand({
          TableName: SHOPPING_CART_DETAIL_TABLE,
          IndexName: "byCartId",
          KeyConditionExpression: "cartId = :cid",
          ExpressionAttributeValues: { ":cid": shoppingCartId },
        })
      );
      const details = (detailResult.Items ?? []) as Record<string, unknown>[];

      const mark = (table: string, id: unknown) =>
        ddb.send(
          new UpdateCommand({
            TableName: table,
            Key: { id: id as string },
            UpdateExpression: "SET wasPaid = :p, updatedAt = :ua",
            ExpressionAttributeValues: { ":p": true, ":ua": now },
          })
        );

      const enrollmentUpdates = details.flatMap((detail) => {
        const updates: Promise<unknown>[] = [];
        if (detail.enrollmentId)        updates.push(mark(ENROLLMENT_TABLE, detail.enrollmentId));
        if (detail.academyEnrollmentId) updates.push(mark(ACADEMY_ENROLLMENT_TABLE, detail.academyEnrollmentId));
        if (detail.privateEnrollmentId) updates.push(mark(PRIVATE_ENROLLMENT_TABLE, detail.privateEnrollmentId));
        return updates;
      });
      await Promise.all(enrollmentUpdates);

      console.log(`[mercadopagoStatus] APPROVED — cart ${shoppingCartId} AUTHORIZED, ${enrollmentUpdates.length} enrollments pagados`);
    }
  }

  return {
    paymentId:        String(payment.id),
    status:           payment.status,
    statusDetail:     payment.status_detail,
    amount:           payment.transaction_amount,
    glosa:            payment.description,
    externalReference: payment.external_reference,
    payerEmail:       payment.payer?.email ?? "",
    paymentMethodId:  payment.payment_method_id,
    dateApproved:     payment.date_approved ?? "",
  };
};
