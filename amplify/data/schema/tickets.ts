import { a } from "@aws-amplify/backend";

// ─── TICKETS / SOPORTE ───────────────────────────────────────────────────────
// manyToMany → tablas join explícitas (Gen 2 v1.x compatible)

export const ticketsSchema = a.schema({
  v2statusTicketType: a.enum(["open", "in_progress", "resolved", "does_not_apply"]),
  v2reasonType: a.enum(["none", "return_session", "payment_problem", "other"]),

  v2SupportTicket: a
    .model({
      date: a.datetime().required(),
      name: a.string().required(),
      email: a.string().required(),
      phoneNumber: a.string().required(),
      description: a.string().required(),
      day: a.string().required(),
      month: a.string().required(),
      year: a.string().default(" "),
      lastModificationUser: a.string().default("sin-usuario"),
      statusTicket: a.ref("v2statusTicketType"),
      reason: a.ref("v2reasonType"),
      studentId: a.id(),
      student: a.belongsTo("v2Student", "studentId"),
      ticketUsers: a.hasMany("v2TicketUser", "ticketId"),
      ticketComments: a.hasMany("v2TicketComment", "ticketId"),
    })
    .secondaryIndexes((index) => [index("date").name("byDate")])
    .authorization((allow) => [allow.authenticated()]),

  v2CommentTickets: a
    .model({
      description: a.string().required(),
      statusModificationIdUser: a.string().default("sin-usuario"),
      statusModificationUser: a.string().default("sin-usuario"),
      ticketComments: a.hasMany("v2TicketComment", "commentId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  // Join table: SupportTicket ↔ Users
  v2TicketUser: a
    .model({
      ticketId: a.id().required(),
      userId: a.id().required(),
      ticket: a.belongsTo("v2SupportTicket", "ticketId"),
      user: a.belongsTo("v2Users", "userId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  // Join table: SupportTicket ↔ CommentTickets
  v2TicketComment: a
    .model({
      ticketId: a.id().required(),
      commentId: a.id().required(),
      ticket: a.belongsTo("v2SupportTicket", "ticketId"),
      comment: a.belongsTo("v2CommentTickets", "commentId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
