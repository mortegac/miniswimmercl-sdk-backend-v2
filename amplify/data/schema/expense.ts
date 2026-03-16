import { a } from "@aws-amplify/backend";

// ─── GASTOS ──────────────────────────────────────────────────────────────────

export const expenseSchema = a.schema({
  v2CostCenterType: a.enum([
    "VITACURA_PISCINA_MUNICIPAL",
    "LA_REINA_PISCINA_MUNICIPAL",
    "MATERIALS",
    "RRHH",
    "ADS",
    "OTHERS",
  ]),

  v2ExpenseType: a.enum([
    "POOL_COURT_RENTAL",
    "MATERIALS",
    "TEACHER",
    "ASSISTANT",
    "ADS_IG",
    "OTHERS",
  ]),

  v2Expense: a
    .model({
      amount: a.float().required(),
      description: a.string(),
      date: a.datetime().required(),
      day: a.integer().required(),
      month: a.integer().required(),
      year: a.integer().required(),
      expenseType: a.ref("v2ExpenseType").required(),
      costCenterType: a.ref("v2CostCenterType").required(),
      // Foreign Keys
      locationId: a.id().required(),
      // Relations
      location: a.belongsTo("v2Location", "locationId"),
    })
    .authorization((allow) => [allow.authenticated()]),
});
