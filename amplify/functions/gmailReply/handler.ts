/**
 * gmailReplyV2 Lambda handler
 *
 * Sends a reply email via Gmail API using a Service Account with domain-wide delegation.
 * The fromAccount must be one of the miniswimmer Gmail accounts.
 *
 * Env vars required:
 *   GMAIL_SECRET_NAME — Secrets Manager secret name (JSON with service account credentials)
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { google } from "googleapis";

const secretsClient = new SecretsManagerClient({});

// ── Helper: encode string to base64url ────────────────────────────────────────
function toBase64Url(str: string): string {
  return Buffer.from(str).toString("base64url");
}

// ── Helper: build a raw MIME email string ─────────────────────────────────────
function buildMimeEmail(params: {
  from: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyToMessageId?: string;
}): string {
  const { from, to, subject, body, inReplyToMessageId } = params;

  const lines: string[] = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
  ];

  if (inReplyToMessageId) {
    lines.push(`In-Reply-To: ${inReplyToMessageId}`);
    lines.push(`References: ${inReplyToMessageId}`);
  }

  lines.push(""); // blank line separating headers from body
  lines.push(body);

  return lines.join("\r\n");
}

// ── Main handler ───────────────────────────────────────────────────────────────
export const handler = async (event: any) => {
  const { fromAccount, toEmail, subject, body, threadId, inReplyToMessageId } = event.arguments ?? event;

  if (!fromAccount || !toEmail || !subject || !body) {
    return {
      success: false,
      error: "Missing required fields: fromAccount, toEmail, subject, body",
    };
  }

  const secretName = process.env.GMAIL_SECRET_NAME!;
  if (!secretName) {
    return { success: false, error: "Missing GMAIL_SECRET_NAME env var" };
  }

  try {
    // Load Service Account credentials
    const secretResponse = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    const serviceAccountKey = JSON.parse(secretResponse.SecretString!);

    // Authenticate impersonating the fromAccount
    const auth = new google.auth.JWT({
      email:   serviceAccountKey.client_email,
      key:     serviceAccountKey.private_key,
      scopes:  [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
      subject: fromAccount,
    });

    const gmail = google.gmail({ version: "v1", auth });

    // Build MIME email
    const mimeRaw = buildMimeEmail({ from: fromAccount, to: toEmail, subject, body, inReplyToMessageId });
    const rawEncoded = toBase64Url(mimeRaw);

    // Send via Gmail API
    const sendResponse = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: rawEncoded,
        ...(threadId ? { threadId } : {}),
      },
    });

    console.log(`[gmailReply] Sent reply from ${fromAccount} to ${toEmail}, messageId: ${sendResponse.data.id}`);

    return {
      success: true,
      messageId: sendResponse.data.id ?? null,
    };
  } catch (err: any) {
    console.error("[gmailReply] Error sending email:", err?.message ?? err);
    return {
      success: false,
      error: err?.message ?? "Unknown error",
    };
  }
};
