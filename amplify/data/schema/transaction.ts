import { a } from "@aws-amplify/backend";

// ─── TRANSACCIONES / CONTABILIDAD ────────────────────────────────────────────

export const transactionSchema = a.schema({
  v2ParametersType: a.enum(["ORDER_PAYMENTTRANSACTIONS"]),
  v2CategoryType: a.enum(["GASTO", "INGRESO"]),

  v2Correlatives: a
    .model({
      type: a.ref("v2ParametersType"),
      correlative: a.float().default(0),
    })
    .secondaryIndexes((index) => [index("type").name("byType")])
    .authorization((allow) => [allow.authenticated()]),

  v2PaymentTransactions: a
    .model({
      status: a.string().default(" "),
      token: a.string().default(" "),
      urlWebpay: a.string().default(" "),
      amount: a.float(),
      buy_order: a.string().default(" "),
      card_number: a.string().default(" "),
      transaction_date: a.string().default(" "),
      accounting_date: a.string().default(" "),
      installments_number: a.string().default(" "),
      payment_type_code: a.string().default(" "),
      session_id: a.string().default(" "),
      card_detail: a.string().default(" "),
      installments_amount: a.string().default(" "),
      authorization_code: a.string().default(" "),
      response_code: a.string().default(" "),
      vci: a.string().default(" "),
      day: a.string().required(),
      month: a.string().required(),
      year: a.string().default(" "),
      hour: a.string(),
      glosa: a.string().required(),
      hasRefund: a.boolean().default(false),
      // Foreign Keys
      usersId: a.id(),
      shoppingCartId: a.id(),
      // Relations
      users: a.belongsTo("v2Users", "usersId"),
      shoppingCart: a.belongsTo("v2ShoppingCart", "shoppingCartId"),
    })
    .secondaryIndexes((index) => [
      index("token").name("byToken"),
      index("day").sortKeys(["month", "year", "hour"]).name("searchByDiaMesAnoHour"),
    ])
    .authorization((allow) => [allow.authenticated()]),

  v2ProfitCenter: a
    .model({
      name: a.string().default(" "),
      code: a.string().default(" "),
      description: a.string().default(" "),
      managerID: a.string().default(" "),
      parentProfitCenterID: a.string().default(" "),
      isActive: a.boolean().default(true),
      // Relations
      transactions: a.hasMany("v2Transactions", "profitCenterID"),
      managers: a.hasMany("v2Managers", "profitCenterID"),
    })
    .secondaryIndexes((index) => [index("code").name("searchByCode")])
    .authorization((allow) => [allow.authenticated()]),

  v2Transactions: a
    .model({
      categoryID: a.string().default(" "),
      categoryType: a.ref("v2CategoryType"),
      amount: a.float(),
      description: a.string().default(" "),
      date: a.string().default(" "),
      month: a.string().default(" "),
      year: a.string().default(" "),
      profitCenterID: a.id().required(),
      // Relations
      profitCenter: a.belongsTo("v2ProfitCenter", "profitCenterID"),
    })
    .secondaryIndexes((index) => [
      index("profitCenterID").sortKeys(["categoryID", "month", "year"]).name("searchByProfitCenter"),
    ])
    .authorization((allow) => [allow.authenticated()]),

  v2Managers: a
    .model({
      firstName: a.string().default(" "),
      lastName: a.string().default(" "),
      email: a.string().default(" "),
      isActive: a.boolean().default(true),
      profitCenterID: a.id().required(),
      // Relations
      profitCenter: a.belongsTo("v2ProfitCenter", "profitCenterID"),
    })
    .secondaryIndexes((index) => [index("email").name("searchByCode")])
    .authorization((allow) => [allow.authenticated()]),
});
