import { a } from "@aws-amplify/backend";

// ─── CARRITO / PRODUCTOS / PROVEEDORES ───────────────────────────────────────

export const shoppingCartSchema = a.schema({
  v2TypeDetail: a.enum([
    "COURSE_REGISTRATION",
    "ENROLLMENTS",
    "ACADEMY",
    "PRODUCTS",
    "DISCOUNT",
    "SERVICES",
  ]),

  v2StatusCommission: a.enum(["CREATED", "TO_PAY", "PAID"]),

  v2SellersCommission: a
    .model({
      salesCommission: a.float().default(0),
      paymentAmount: a.float().default(0),
      amount: a.float().default(0),
      type: a.ref("v2TypeDetail").required(),
      description: a.string().default(""),
      status: a.ref("v2StatusCommission").required(),
      // Foreign Keys
      usersId: a.id(),
      // Relations
      users: a.belongsTo("v2Users", "usersId"),
      shoppingCart: a.hasOne("v2ShoppingCart", "sellersCommissionId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2ShoppingCart: a
    .model({
      totalPrice: a.float().required(),
      status: a.string().default("PENDING"),
      createdAt: a.string().required(),
      // Foreign Keys
      userId: a.id().required(),
      sellerId: a.id().required(),
      sellersCommissionId: a.id(),
      // Relations
      user: a.belongsTo("v2Users", "userId"),
      seller: a.belongsTo("v2Users", "sellerId"),
      sellersCommission: a.belongsTo("v2SellersCommission", "sellersCommissionId"),
      cartDetails: a.hasMany("v2ShoppingCartDetail", "cartId"),
      paymentTransactions: a.hasMany("v2PaymentTransactions", "shoppingCartId"),
    })
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  v2ShoppingCartDetail: a
    .model({
      type: a.ref("v2TypeDetail").required(),
      quantity: a.integer().required(),
      amount: a.float().required(),
      detail: a.string().required(),
      wasDeleted: a.boolean().default(false),
      // Foreign Keys
      cartId: a.id().required(),
      enrollmentId: a.id(),
      academyEnrollmentId: a.id(),
      privateEnrollmentId: a.id(),
      createdById: a.id(),
      // Relations
      cart: a.belongsTo("v2ShoppingCart", "cartId"),
      enrollment: a.belongsTo("v2Enrollment", "enrollmentId"),
      academyEnrollment: a.belongsTo("v2AcademyEnrollment", "academyEnrollmentId"),
      privateEnrollment: a.belongsTo("v2PrivateEnrollment", "privateEnrollmentId"),
      createdBy: a.belongsTo("v2Users", "createdById"),
    })
    .secondaryIndexes((index) => [index("cartId").name("byCartId")])
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  v2Supplier: a
    .model({
      name: a.string().required(),
      contactPerson: a.string(),
      email: a.string(),
      phone: a.string(),
      address: a.string(),
      taxId: a.string(),
      isActive: a.boolean().default(true),
      // Relations
      products: a.hasMany("v2Product", "supplierId"),
    })
    .authorization((allow) => [allow.authenticated()]),

  v2Product: a
    .model({
      sku: a.string().required(),
      name: a.string().required(),
      currentStock: a.integer().required(),
      criticalStock: a.integer().required(),
      purchasePrice: a.float().required(),
      sellingPrice: a.float().required(),
      profits: a.float().required(),
      isActive: a.boolean().default(true),
      // Foreign Keys
      supplierId: a.id().required(),
      // Relations
      supplier: a.belongsTo("v2Supplier", "supplierId"),
    })
    .secondaryIndexes((index) => [index("sku").name("bySku")])
    .authorization((allow) => [allow.authenticated()]),
});
