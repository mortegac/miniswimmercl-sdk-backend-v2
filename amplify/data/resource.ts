import { a, defineData } from "@aws-amplify/backend";
import { academySchema } from "./schema/academy";
import { coachesSchema } from "./schema/coaches";
import { emailSendSchema } from "./schema/emailSend";
import { evaluationsSchema } from "./schema/evaluations";
import { parametersSchema } from "./schema/parameters";
import { privateLessonsSchema } from "./schema/privateLessons";
import { resolversSchema } from "./schema/resolvers";
import { rolesSchema } from "./schema/roles";
import { schoolSchema } from "./schema/school";
import { schoolEnrollmentSchema } from "./schema/schoolEnrollment";
import { shoppingCartSchema } from "./schema/shoppingCart";
import { ticketsSchema } from "./schema/tickets";
import { transactionSchema } from "./schema/transaction";
import { usersSchema } from "./schema/users";
import { gmailInboxSchema } from "./schema/gmailInbox";

/**
 * V2 - Amplify Gen 2 Schema (Miniswimmer)
 *
 * Referencia: miniswimmercl_customers_clientv2/amplify/backend/api/apiclients/schema/
 *
 * Todos los modelos llevan el prefijo "v2" para distinguirlos de Gen 1.
 * Tablas DynamoDB resultantes: v2ModelName-{appId}-{env}
 *
 * NO toca ningún recurso existente.
 */
const schema = a.combine([
  academySchema,
  coachesSchema,
  emailSendSchema,
  evaluationsSchema,
  parametersSchema,
  privateLessonsSchema,
  resolversSchema,
  rolesSchema,
  schoolSchema,
  schoolEnrollmentSchema,
  shoppingCartSchema,
  ticketsSchema,
  transactionSchema,
  usersSchema,
  gmailInboxSchema,
]);

export type Schema = typeof schema;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    // API Key para la app pública de pagos (sin login de Cognito)
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
  name: "v2-sdk-backend",
});
