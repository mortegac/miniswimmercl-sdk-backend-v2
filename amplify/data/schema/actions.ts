import { a } from "@aws-amplify/backend";

// ─── ACCIONES SOBRE EL CLIENTE ────────────────────────────────────────────────
// Registra cada acción/interacción realizada sobre un Customer (lead CRM).
// Relación: 1 Customer → muchas Actions

export const actionsSchema = a.schema({
  v2Action: a
    .model({
      status:      a.string().required(),   // CREADO | CONTACTADO | EN_PROCESO | CERRADO | DESCARTADO
      message:     a.string().required(),   // descripción de la acción
      urlDocument: a.string(),              // URL del documento adjunto (opcional)
      userId:      a.string(),              // ID del usuario que registró la acción (AppUser.id = email)
      customerId:  a.id().required(),
      customer:    a.belongsTo("v2Customer", "customerId"),
    })
    .secondaryIndexes((index) => [
      index("customerId").name("byCustomer"),
    ])
    .authorization((allow) => [allow.authenticated()]),
});
