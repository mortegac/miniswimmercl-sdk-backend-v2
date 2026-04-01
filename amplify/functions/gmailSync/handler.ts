/**
 * gmailSyncV2 Lambda handler
 *
 * Syncs Gmail inbox messages from the last 7 days into DynamoDB (v2GmailInbox table).
 * Supports multiple Gmail accounts (GMAIL_ACCOUNTS env var, comma-separated).
 * Resolves userId from fromEmail via v2Users byEmail GSI.
 *
 * Env vars required:
 *   GMAIL_SECRET_NAME    — Secrets Manager secret name (JSON with service account credentials)
 *   GMAIL_ACCOUNTS       — Comma-separated Gmail addresses to sync (e.g. "hola@miniswimmer.cl,welcome@miniswimmer.cl")
 *   GMAIL_INBOX_TABLE    — DynamoDB table name for v2GmailInbox
 *   USERS_TABLE          — DynamoDB table name for v2Users (for userId resolution)
 */

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { google, gmail_v1 } from "googleapis";
import { randomUUID } from "crypto";

// ── AWS clients (module-level singletons for warm-start reuse) ─────────────────
const secretsClient = new SecretsManagerClient({});
const dynamoClient  = new DynamoDBClient({});
const docClient     = DynamoDBDocumentClient.from(dynamoClient);

// ── Helper: decode base64url Gmail body data ───────────────────────────────────
function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

// ── Helper: extract a header value by name ────────────────────────────────────
function getHeader(headers: { name?: string | null; value?: string | null }[], name: string): string {
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? "";
}

// ── Helper: parse "Name <email@domain.com>" → { fromName, fromEmail } ─────────
function parseFrom(fromHeader: string): { fromName: string; fromEmail: string } {
  const match = fromHeader.match(/^(.*?)\s*<(.+?)>$/);
  if (match) {
    return {
      fromName:  match[1].trim().replace(/^"|"$/g, ""),
      fromEmail: match[2].trim().toLowerCase(),
    };
  }
  return { fromName: "", fromEmail: fromHeader.trim().toLowerCase() };
}

// ── Helper: parse "To" header → array of email addresses ──────────────────────
function parseToEmails(toHeader: string): string[] {
  if (!toHeader) return [];
  return toHeader
    .split(",")
    .map((entry) => {
      const match = entry.match(/<(.+?)>/);
      return match ? match[1].trim().toLowerCase() : entry.trim().toLowerCase();
    })
    .filter(Boolean);
}

// ── Helper: recursively extract text/plain and text/html ──────────────────────
function extractBody(
  parts: any[],
  result: { text: string; html: string } = { text: "", html: "" }
): { text: string; html: string } {
  for (const part of parts) {
    const mimeType = part.mimeType ?? "";
    if (mimeType === "text/plain" && part.body?.data) {
      result.text = decodeBase64Url(part.body.data);
    } else if (mimeType === "text/html" && part.body?.data) {
      result.html = decodeBase64Url(part.body.data);
    } else if (part.parts && Array.isArray(part.parts)) {
      extractBody(part.parts, result);
    }
  }
  return result;
}

// ── Helper: collect attachment metadata ───────────────────────────────────────
function extractAttachments(parts: any[]): { filename: string; mimeType: string; size: number; attachmentId: string }[] {
  const attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
  function walk(partList: any[]) {
    for (const part of partList) {
      if (part.filename && part.filename.length > 0) {
        attachments.push({
          filename:     part.filename,
          mimeType:     part.mimeType ?? "",
          size:         part.body?.size ?? 0,
          attachmentId: part.body?.attachmentId ?? "",
        });
      }
      if (part.parts && Array.isArray(part.parts)) walk(part.parts);
    }
  }
  walk(parts);
  return attachments;
}

// ── Helper: check if message already exists via byMessageId GSI ───────────────
async function messageExists(tableName: string, messageId: string): Promise<boolean> {
  const response = await docClient.send(
    new QueryCommand({
      TableName:                 tableName,
      IndexName:                 "byMessageId",
      KeyConditionExpression:    "messageId = :mid",
      ExpressionAttributeValues: { ":mid": messageId },
      Limit:                     1,
      ProjectionExpression:      "id",
    })
  );
  return (response.Count ?? 0) > 0;
}

// ── Helper: lookup a single email in v2Users via byEmail GSI ──────────────────
async function lookupUserId(usersTable: string, email: string): Promise<string | null> {
  if (!email) return null;
  try {
    const response = await docClient.send(
      new QueryCommand({
        TableName:                 usersTable,
        IndexName:                 "byEmail",
        KeyConditionExpression:    "email = :email",
        ExpressionAttributeValues: { ":email": email },
        Limit:                     1,
        ProjectionExpression:      "id",
      })
    );
    return response.Items?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ── Helper: resolve userId checking fromEmail then toEmails ───────────────────
// Excludes own miniswimmer accounts from toEmails to avoid false matches.
const MINISWIMMER_ACCOUNTS = new Set(["hola@miniswimmer.cl", "welcome@miniswimmer.cl"]);

async function resolveUserId(
  usersTable: string,
  fromEmail: string,
  toEmails: string[],
): Promise<string | null> {
  // 1. Check fromEmail first (apoderado wrote TO miniswimmer) — skip own accounts
  if (!MINISWIMMER_ACCOUNTS.has(fromEmail)) {
    const fromMatch = await lookupUserId(usersTable, fromEmail);
    if (fromMatch) return fromMatch;
  }

  // 2. Check each toEmail (miniswimmer wrote TO apoderado)
  for (const email of toEmails) {
    if (MINISWIMMER_ACCOUNTS.has(email)) continue;
    const toMatch = await lookupUserId(usersTable, email);
    if (toMatch) return toMatch;
  }

  return null;
}

// ── Sync a single Gmail account ────────────────────────────────────────────────
async function syncAccount(
  gmail: ReturnType<typeof google.gmail>,
  gmailAccount: string,
  afterDate: string,
  tableName: string,
  usersTable: string,
): Promise<{ totalFetched: number; newSaved: number; alreadyExisted: number; errors: number }> {
  const query = `after:${afterDate}`;
  console.log(`[${gmailAccount}] Fetching messages with query: "${query}"`);

  // List all message IDs (paginated)
  const messageIds: string[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const listResponse: { data: gmail_v1.Schema$ListMessagesResponse } = await gmail.users.messages.list({
      userId:     "me",
      q:          query,
      maxResults: 500,
      pageToken,
    });
    const messages = listResponse.data.messages ?? [];
    for (const msg of messages) {
      if (msg.id) messageIds.push(msg.id);
    }
    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  console.log(`[${gmailAccount}] Total messages found: ${messageIds.length}`);

  let saved = 0, skipped = 0, errors = 0;

  for (const msgId of messageIds) {
    try {
      const exists = await messageExists(tableName, msgId);
      if (exists) { skipped++; continue; }

      const msgResponse = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
      const msg     = msgResponse.data;
      const headers = msg.payload?.headers ?? [];
      const labels  = msg.labelIds ?? [];
      const parts   = msg.payload?.parts ?? [];

      const subject    = getHeader(headers, "Subject");
      const fromHeader = getHeader(headers, "From");
      const toHeader   = getHeader(headers, "To");
      const dateHeader = getHeader(headers, "Date");

      const { fromName, fromEmail } = parseFrom(fromHeader);
      const toEmails = parseToEmails(toHeader);

      let dateSent: Date;
      if (msg.internalDate) {
        dateSent = new Date(parseInt(msg.internalDate, 10));
      } else {
        dateSent = new Date(dateHeader);
      }
      const dateSentIso = dateSent.toISOString();
      const dateStr     = dateSentIso.slice(0, 10);

      let bodyText = "", bodyHtml = "";
      if (msg.payload?.body?.data) {
        const mimeType = msg.payload.mimeType ?? "";
        if (mimeType === "text/html") bodyHtml = decodeBase64Url(msg.payload.body.data);
        else bodyText = decodeBase64Url(msg.payload.body.data);
      } else if (parts.length > 0) {
        const extracted = extractBody(parts);
        bodyText = extracted.text;
        bodyHtml = extracted.html;
      }

      const attachments    = extractAttachments(parts);
      const hasAttachments = attachments.length > 0;
      const isRead         = !labels.includes("UNREAD");

      // Resolve apoderado userId: check fromEmail first, then toEmails
      const userId = await resolveUserId(usersTable, fromEmail, toEmails);

      const now  = new Date().toISOString();
      const item: Record<string, any> = {
        id:             randomUUID(),
        __typename:     "v2GmailInbox",
        createdAt:      now,
        updatedAt:      now,
        messageId:      msgId,
        threadId:       msg.threadId ?? "",
        subject:        subject   || null,
        fromEmail:      fromEmail || null,
        fromName:       fromName  || null,
        toEmails:       toEmails.length  > 0 ? toEmails  : null,
        dateSent:       dateSentIso,
        dateStr,
        snippet:        msg.snippet ?? null,
        bodyText:       bodyText   || null,
        bodyHtml:       bodyHtml   || null,
        labels:         labels.length > 0 ? labels : null,
        isRead,
        hasAttachments,
        attachments:    hasAttachments ? JSON.stringify(attachments) : null,
        gmailAccount,
      };

      if (userId) item.userId = userId;

      await docClient.send(
        new PutCommand({
          TableName:           tableName,
          Item:                item,
          ConditionExpression: "attribute_not_exists(id)",
        })
      );

      saved++;
      console.log(`[${gmailAccount}] Saved: ${msgId} — "${subject}" from ${fromEmail}${userId ? ` (userId: ${userId})` : ""}`);
    } catch (err: any) {
      errors++;
      console.error(`[${gmailAccount}] Error processing message ${msgId}:`, err?.message ?? err);
    }
  }

  return { totalFetched: messageIds.length, newSaved: saved, alreadyExisted: skipped, errors };
}

// ── Main handler ───────────────────────────────────────────────────────────────
export const handler = async (event: any) => {
  console.log("gmailSyncV2 started", { event });

  const secretName   = process.env.GMAIL_SECRET_NAME!;
  const gmailAccounts = (process.env.GMAIL_ACCOUNTS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const tableName    = process.env.GMAIL_INBOX_TABLE!;
  const usersTable   = process.env.USERS_TABLE!;

  if (!secretName || gmailAccounts.length === 0 || !tableName || !usersTable) {
    throw new Error("Missing required env vars: GMAIL_SECRET_NAME, GMAIL_ACCOUNTS, GMAIL_INBOX_TABLE, USERS_TABLE");
  }

  // Load Google Service Account credentials
  console.log(`Fetching service account secret: ${secretName}`);
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  const serviceAccountKey = JSON.parse(secretResponse.SecretString!);

  // Date filter: last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const afterDate = `${sevenDaysAgo.getFullYear()}/${String(sevenDaysAgo.getMonth() + 1).padStart(2, "0")}/${String(sevenDaysAgo.getDate()).padStart(2, "0")}`;

  const results: Record<string, any> = {};

  for (const gmailAccount of gmailAccounts) {
    // Authenticate with domain-wide delegation impersonating each account
    const auth = new google.auth.JWT({
      email:   serviceAccountKey.client_email,
      key:     serviceAccountKey.private_key,
      scopes:  ["https://www.googleapis.com/auth/gmail.readonly"],
      subject: gmailAccount,
    });
    const gmail = google.gmail({ version: "v1", auth });

    results[gmailAccount] = await syncAccount(gmail, gmailAccount, afterDate, tableName, usersTable);
  }

  console.log("gmailSyncV2 completed", results);
  return results;
};
