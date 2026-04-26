import type { Handler } from "aws-lambda";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// ─── Config ───────────────────────────────────────────────────────────────────
const MP_SECRET_NAME = process.env.MP_SECRET_NAME!;
const FRONTEND_URL   = process.env.FRONTEND_URL ?? "https://pagos.miniswimmer.cl";

// ─── Secrets client (singleton) ───────────────────────────────────────────────
const secretsClient = new SecretsManagerClient({});

let mpCredentials: { access_token: string; access_token_test: string } | undefined;

async function getMpAccessToken(): Promise<string> {
  if (!mpCredentials) {
    const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: MP_SECRET_NAME }));
    mpCredentials = JSON.parse(res.SecretString!) as typeof mpCredentials;
  }
  const isTest = FRONTEND_URL.includes("localhost");
  return isTest ? mpCredentials!.access_token_test : mpCredentials!.access_token;
}

// ─── MP payment API response ──────────────────────────────────────────────────
interface MpPaymentResponse {
  id:                   number;
  status:               string;
  status_detail:        string;
  transaction_amount:   number;
  description:          string;
  external_reference:   string;
  payer:                { email?: string };
  payment_method_id:    string;
  date_approved:        string | null;
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

  console.log("[mercadopagoStatus] paymentId:", paymentId, "status:", payment.status);

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
