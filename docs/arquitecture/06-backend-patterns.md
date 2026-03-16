# 06 — Patrones de Backend

Documentación de los patrones de código adoptados desde el proyecto de referencia EMA-back.
El objetivo es mantener consistencia, observabilidad y testabilidad en toda la capa Lambda.

## Estructura de carpetas

```
backend/
├── src/
│   ├── index.ts                    ← Lambda entry point (dispatcher)
│   ├── types/
│   │   ├── appsync.ts              ← Tipos del evento AppSync
│   │   └── models.ts               ← Tipos de dominio (Customer, User, Webform)
│   ├── util/
│   │   ├── log.ts                  ← Logger singleton
│   │   ├── error.ts                ← throwError() + extractErrorMessage()
│   │   └── db/
│   │       ├── client.ts           ← DynamoDB SDK v3 + entityKeys
│   │       ├── RepositoryFactory.ts← CRUD tipado genérico
│   │       └── validateResponse.ts ← Validación de respuestas
│   └── resolvers/
│       ├── customer/
│       │   ├── handler.ts          ← Lógica de negocio
│       │   └── customer.test.ts    ← Tests Vitest
│       ├── user/
│       │   ├── handler.ts
│       │   └── user.test.ts
│       └── webform/
│           ├── handler.ts
│           └── webform.test.ts
├── build.mjs                       ← esbuild con path alias resolution
├── vitest.config.ts                ← config de tests con aliases
├── eslint.config.js                ← ESLint 9 flat config
├── prettier.config.js
└── tsconfig.json                   ← con paths aliases
```

## Path aliases

En lugar de rutas relativas largas (`../../util/log`), usamos aliases cortos.
Definidos en 3 lugares que deben mantenerse sincronizados:

```
tsconfig.json      → para TypeScript type checking
vitest.config.ts   → para tests
build.mjs          → para el bundle de producción
```

```typescript
// Sin alias (antes)
import { logger } from "../../util/log";
import { throwError } from "../../util/error";
import { getItem } from "../../util/db/client";

// Con alias (ahora)
import { logger } from "@log";
import { throwError } from "@error";
import { getItem } from "@db/client";
```

| Alias | Archivo |
|---|---|
| `@log` | `src/util/log.ts` |
| `@error` | `src/util/error.ts` |
| `@db/client` | `src/util/db/client.ts` |
| `@db/RepositoryFactory` | `src/util/db/RepositoryFactory.ts` |
| `@db/validateResponse` | `src/util/db/validateResponse.ts` |

---

## Patrón 1 — Logger Singleton

**Archivo:** `src/util/log.ts`

Logger centralizado que detecta el entorno automáticamente:
- En **AWS Lambda**: JSON estructurado compatible con CloudWatch Logs Insights
- En **desarrollo local**: texto legible con colores

```typescript
import { logger } from "@log";

logger.info("Operación iniciada", { customerId: "01J..." });
logger.warn("Recurso no encontrado", { id });
logger.error("Error crítico", { error: error.message, stack });
logger.debug("Detalle técnico", { query, params }); // solo en LOG_LEVEL=4
```

**Log estructurado en CloudWatch:**
```json
{
  "timestamp": "2026-03-14T10:30:00.000Z",
  "level": "INFO",
  "message": "Customer created successfully",
  "functionName": "mytascensores-backoffice-resolver-dev",
  "awsRequestId": "abc-123",
  "xrayTraceId": "Root=1-...",
  "environment": "production",
  "context": {
    "operation": "Mutation.createCustomer",
    "userId": "01J8USER00",
    "requestId": "req-xyz"
  }
}
```

**Niveles:**
```
NONE  = 0   sin logs
ERROR = 1   solo errores críticos
WARN  = 2   advertencias
INFO  = 3   flujo normal (default)
DEBUG = 4   detalles técnicos (desarrollo)
```

**Configuración:** variable de entorno `LOG_LEVEL` (string numérico).

---

## Patrón 2 — throwError (Error Handling Centralizado)

**Archivo:** `src/util/error.ts`

Función overloaded que **siempre loguea antes de lanzar** el error.
Garantiza que ningún error pase desapercibido en CloudWatch.

```typescript
import { throwError, extractErrorMessage, createErrorContext } from "@error";

// Mensaje simple
throwError("Customer not found");

// Envolviendo un error existente
try {
  await cognitoClient.send(command);
} catch (error) {
  throwError("Failed to create Cognito user", error);
  // → Loguea: "Failed to create Cognito user: <mensaje original>"
  // → Stack trace: stack actual + "Caused by: <stack original>"
}

// Con contexto estructurado
throwError("Validation failed", createErrorContext({
  customerId: id,
  operation: "updateCustomer",
  invalidFields: ["email"],
}));

// Re-lanzar un Error existente
throwError(existingError);

// Múltiples errores
throwError([error1, error2]);
```

**`extractErrorMessage`** — para obtener el mensaje sin lanzar:
```typescript
} catch (error) {
  const message = extractErrorMessage(error); // seguro con cualquier tipo
  logger.error("Handler failed", { message });
  throw new Error(message);
}
```

---

## Patrón 3 — RepositoryFactory

**Archivo:** `src/util/db/RepositoryFactory.ts`

Fábrica genérica que produce un repositorio CRUD tipado para cada entidad.
Elimina boilerplate de logging y validación en cada handler.

**Firma:**
```typescript
function RepositoryFactory<TDomain, TRecord, TCreate, TUpdate>({
  entityName,    // para logging
  keys,          // { pk, sk } — funciones de clave DynamoDB
  toRecord,      // (input, id, now, createdBy) → TRecord
  fromRecord,    // (record) → TDomain  (quita PK, SK, GSI*, entityType)
  buildUpdatePayload?, // (current, input, now) → Record<string, unknown>
}): Repository<TDomain, TCreate, TUpdate>
```

**Repositorio resultante:**
```typescript
interface Repository<TDomain, TCreate, TUpdate> {
  getById(id: string): Promise<TDomain | null>
  create(input: TCreate, createdBy: string): Promise<TDomain>
  update(input: TUpdate): Promise<TDomain>
  remove(id: string): Promise<string>
  query(params): Promise<Connection<TDomain>>
}
```

**Ejemplo de uso en un resolver:**
```typescript
const customerRepo = RepositoryFactory<Customer, CustomerRecord, CreateCustomerInput, UpdateCustomerInput>({
  entityName: "Customer",
  keys: entityKeys.customer,

  toRecord: (input, id, now, createdBy) => ({
    PK: `CUSTOMER#${id}`,
    SK: "METADATA",
    GSI1PK: `CUSTOMER#ACTIVE`,
    GSI1SK: now,
    entityType: "CUSTOMER",
    id, ...input,
    status: "ACTIVE",
    createdAt: now, updatedAt: now, createdBy,
  }),

  fromRecord: ({ PK, SK, GSI1PK, GSI1SK, entityType, ...domain }) => domain as Customer,

  buildUpdatePayload: (current, input, now) => {
    const payload = { ...input, updatedAt: now };
    if (input.status !== current.status) {
      payload.GSI1PK = `CUSTOMER#${input.status}`; // mueve en GSI
    }
    return payload;
  },
});

// En el handler — clean, sin boilerplate
export async function createCustomer(event) {
  return customerRepo.create(event.arguments.input, event.identity.sub);
}
```

**Cada operación incluye automáticamente:**
- `logger.info("Creating Customer", data)` antes de operar
- `logger.info("Customer created successfully")` al terminar
- `throwError("Customer could not be created", error)` si falla
- Validación de respuesta DynamoDB

---

## Patrón 4 — Dispatcher con Logger Context

**Archivo:** `src/index.ts`

El Lambda entry point:
1. Extrae la operación del evento AppSync
2. **Inyecta contexto en el logger** para que todos los logs de la invocación lleven `operation`, `userId` y `requestId`
3. Despacha al handler correspondiente
4. **Limpia el contexto** en `finally` para evitar leaks entre invocaciones

```typescript
export const handler = async (event: AppSyncEvent<never>) => {
  logger.setContext({                    // ← todos los logs llevarán esto
    operation: `${event.typeName}.${event.fieldName}`,
    userId:    event.identity?.sub,
    requestId: event.request?.headers?.["x-amzn-requestid"],
  });

  try {
    const resolver = resolverMap[key];
    return await resolver(event);
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  } finally {
    logger.clearContext();               // ← limpieza obligatoria
  }
};
```

---

## Patrón 5 — Estructura de tests

Cada resolver tiene su propio archivo de test en la misma carpeta:

```
resolvers/customer/
  ├── handler.ts
  └── customer.test.ts
```

**Mocking con Vitest:**
```typescript
// Siempre mockear las dependencias externas con alias
vi.mock("@db/client", () => ({
  getItem:         vi.fn(),
  putItem:         vi.fn(),
  updateItem:      vi.fn(),
  deleteItem:      vi.fn(),
  queryItems:      vi.fn(),
  decodeNextToken: vi.fn(),
  TABLE_NAME:      "test-table",
  entityKeys:      { customer: { pk: (id) => `CUSTOMER#${id}`, ... } },
}));

vi.mock("@log",   () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@error", () => ({ throwError: vi.fn((msg) => { throw new Error(msg); }) }));
vi.mock("ulid",   () => ({ ulid: () => "01JTEST000000000000000000" }));
```

**Patrón de factory para eventos mock:**
```typescript
const mockEvent = <T>(args: T): AppSyncEvent<T> => ({
  typeName:  "Query",
  fieldName: "test",
  arguments: args,
  identity:  { sub: "user-123", username: "test@test.com" },
  // ...
});
```

---

## Build — esbuild con path aliases

**Archivo:** `build.mjs`

esbuild bundlea todo en un solo `dist/index.js` (CommonJS para Lambda)
con los `@aws-sdk/*` externalizados (disponibles en el runtime de Lambda).

```javascript
await build({
  entryPoints: ["src/index.ts"],
  bundle:      true,
  platform:    "node",
  target:      "node22",
  format:      "cjs",
  outfile:     "dist/index.js",
  external:    ["@aws-sdk/*"],
  alias: {
    "@log":              "src/util/log.ts",
    "@error":            "src/util/error.ts",
    "@db/client":        "src/util/db/client.ts",
    "@db/RepositoryFactory": "src/util/db/RepositoryFactory.ts",
  },
});
```

## Calidad de código

```
ESLint 9 (flat config)  → no-console warn, prefer-const, trailing commas
Prettier               → semi, 100 col, trailingComma: es5
TypeScript strict      → noImplicitAny, strictNullChecks, etc.
Husky pre-commit       → corre tests antes de cada commit
Vitest                 → tests unitarios con mocks
```

**Comandos:**
```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src
npm run lint:fix    # eslint src --fix
npm run format      # prettier --write
npm run test        # vitest run
npm run coverage    # vitest --coverage
npm run build       # node build.mjs → dist/index.js
```
