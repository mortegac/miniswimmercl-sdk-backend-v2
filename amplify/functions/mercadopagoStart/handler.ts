import type { Handler } from "aws-lambda";
import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// ─── Config ───────────────────────────────────────────────────────────────────
const PAYMENT_TRANSACTIONS_TABLE = process.env.PAYMENT_TRANSACTIONS_TABLE!;
const MP_SECRET_NAME             = process.env.MP_SECRET_NAME!;
const FRONTEND_URL               = process.env.FRONTEND_URL ?? "https://pagos.miniswimmer.cl";

// ─── Clients (singletons) ─────────────────────────────────────────────────────
const secretsClient = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Credentials cache ────────────────────────────────────────────────────────
let mpCredentials: { access_token: string; access_token_test: string } | undefined;

async function getMpAccessToken(): Promise<string> {
  if (!mpCredentials) {
    const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: MP_SECRET_NAME }));
    mpCredentials = JSON.parse(res.SecretString!) as typeof mpCredentials;
  }
  const isTest = FRONTEND_URL.includes("localhost");
  return isTest ? mpCredentials!.access_token_test : mpCredentials!.access_token;
}

// ─── MP preference API response ───────────────────────────────────────────────
interface MpPreferenceResponse {
  id: string;
  init_point: string;
  sandbox_init_point: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {
  const { amount, userId, glosa, cartId } = event.arguments as {
    amount: number;
    userId: string;
    glosa: string;
    cartId: string;
  };

  if (!cartId)    throw new Error("cartId is required");
  if (!userId)    throw new Error("userId is required");
  if (!glosa)     throw new Error("glosa is required");
  if (amount <= 0) throw new Error("amount must be positive");

  const accessToken = await getMpAccessToken();

  const preferenceBody = {
    items: [{
      id:         cartId,
      title:      glosa,
      quantity:   1,
      unit_price: Math.round(amount),
      currency_id: "CLP",
    }],
    payer: { email: userId },
    back_urls: {
      success: `${FRONTEND_URL}/return-mp?status=approved`,
      failure: `${FRONTEND_URL}/return-mp?status=failure`,
      pending: `${FRONTEND_URL}/return-mp?status=pending`,
    },
    auto_return:         "approved",
    external_reference:  cartId,
    binary_mode:         true,
    statement_descriptor: "MINISWIMMER",
  };

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(preferenceBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`MercadoPago API error ${response.status}: ${errorBody}`);
  }

  const preference = (await response.json()) as MpPreferenceResponse;

  console.log("[mercadopagoStart] preference created:", preference.id, "cartId:", cartId);

  // ── Registrar transacción PENDING_MP en DynamoDB ──────────────────────────
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: PAYMENT_TRANSACTIONS_TABLE,
    Item: {
      id:              randomUUID(),
      __typename:      "v2PaymentTransactions",
      createdAt:       now,
      updatedAt:       now,
      status:          "PENDING_MP",
      token:           preference.id,           // preferenceId usado como token
      amount,
      glosa,
      usersId:         userId,
      shoppingCartId:  cartId,
      preferenceId:    preference.id,
    },
  }));

  return {
    preferenceId:    preference.id,
    initPoint:       preference.init_point,
    sandboxInitPoint: preference.sandbox_init_point,
  };
};
