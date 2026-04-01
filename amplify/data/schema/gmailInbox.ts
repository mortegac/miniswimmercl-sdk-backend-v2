import { a } from "@aws-amplify/backend";

export const gmailInboxSchema = a.schema({
  v2GmailInbox: a
    .model({
      messageId:      a.string().required(),
      threadId:       a.string().required(),
      subject:        a.string(),
      fromEmail:      a.string(),
      fromName:       a.string(),
      toEmails:       a.string().array(),
      dateSent:       a.datetime().required(),
      dateStr:        a.string().required(),   // "YYYY-MM-DD" — used for GSI byDate
      snippet:        a.string(),
      bodyText:       a.string(),
      bodyHtml:       a.string(),
      labels:         a.string().array(),
      isRead:         a.boolean().default(false),
      hasAttachments: a.boolean().default(false),
      attachments:    a.json(),
      gmailAccount:   a.string().required(),   // cuenta receptora: hola@ | welcome@
      // relación con apoderado (nullable — no todos los remitentes son usuarios)
      userId:         a.id(),
      user:           a.belongsTo("v2Users", "userId"),
    })
    .secondaryIndexes((index) => [
      index("messageId").name("byMessageId"),
      index("gmailAccount").sortKeys(["dateSent"]).name("byAccountDate"),
      index("fromEmail").sortKeys(["dateSent"]).name("byFromEmail"),  // emails de un remitente ordenados por fecha
      index("dateStr").name("byDate"),
      index("userId").sortKeys(["dateSent"]).name("byUserId"),        // todos los emails de un apoderado
    ])
    .authorization((allow) => [allow.authenticated()]),
});
