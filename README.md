# Miniswimmer Backoffice — SDK Backend V2

Monorepo para el backoffice de una escuela de natación. Gestiona alumnos, clases, entrenadores, inscripciones, tickets de soporte y reportes de jornada sobre infraestructura serverless en AWS.

---

## Arquitectura general

```
┌─────────────┐     GraphQL      ┌──────────────┐     Lambda      ┌──────────────┐
│  Frontend   │ ───────────────► │   AppSync    │ ──────────────► │   Backend    │
│  React 19   │                  │  (GraphQL)   │                  │  Node.js 22  │
│  Vite + RTK │ ◄─────────────── │              │ ◄────────────── │  TypeScript  │
└─────────────┘   Subscriptions  └──────────────┘                  └──────────────┘
                                        │                                  │
                                        ▼                                  ▼
                                 ┌──────────────┐              ┌──────────────────┐
                                 │   Cognito    │              │    DynamoDB      │
                                 │  User Pools  │              │  Single-table    │
                                 └──────────────┘              └──────────────────┘
```

### Dos sistemas en paralelo

| | Gen 1 (CDK) | Gen 2 (Amplify) |
|---|---|---|
| **Ubicación** | `infrastructure/` + `backend/` | `amplify/` |
| **Deploy** | `npm run infra:deploy` | `npx ampx sandbox` |
| **Prefijo modelos** | sin prefijo | `v2` (ej. `v2Student`) |
| **Estado** | Producción — no tocar | Desarrollo activo |
| **Stack names** | `miniswimmer-backofficev2-{auth\|database\|api}-dev` | `amplify-backoffice-manu-sandbox-*` |

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 19, Redux Toolkit, React Router 7, Vite, `@aws-amplify/ui-react` |
| Backend | Node.js 22, TypeScript 5.8, AWS Lambda, esbuild |
| API | AWS AppSync (GraphQL), subscriptions en tiempo real |
| Base de datos | DynamoDB single-table, PAY_PER_REQUEST, GSI1 + GSI2 |
| Auth | AWS Cognito User Pools |
| Infraestructura | AWS CDK v2, Amplify Gen 2 |
| Observabilidad | Structured logging, AWS X-Ray |
| Calidad | ESLint, Prettier, Vitest, Husky pre-commit |

---

## Estructura del repositorio

```
miniswimmercl-sdk-backend-v2/
├── amplify/               # Amplify Gen 2 — esquemas v2 (desarrollo activo)
│   ├── auth/              # Cognito resource
│   ├── data/
│   │   ├── schema/        # 16 archivos de dominio (academy, coaches, tickets…)
│   │   └── resource.ts    # a.combine([...]) de todos los schemas
│   └── backend.ts
├── backend/               # Lambda resolvers Gen 1
│   └── src/
│       ├── resolvers/     # customer, user, webform handlers
│       ├── util/db/       # RepositoryFactory, DynamoDB client
│       └── types/
├── frontend/              # React SPA
│   └── src/
│       ├── api/graphql/   # mutations, queries, subscriptions
│       └── store/         # Redux slices
├── infrastructure/        # AWS CDK v2 stacks Gen 1
│   └── lib/stacks/        # auth, database, api stacks (v1 + v2)
├── schema/                # GraphQL schemas
│   ├── schema.graphql     # Gen 1 (producción)
│   └── schema-v2.graphql  # Gen 2
└── docs/
    ├── arquitecture/      # Documentación técnica detallada
    └── runbooks/          # Guías de deploy y operaciones
```

---

## Prerrequisitos

- Node.js 22+
- AWS CLI configurado con perfil `miniswimmer` (cuenta `995007408497`, región `us-east-2`)
- AWS CDK CLI: `npm install -g aws-cdk`
- Amplify CLI: incluido como dev dependency (`@aws-amplify/backend-cli`)

---

## Instalación

```bash
# Instalar dependencias del monorepo (infrastructure, backend, frontend)
npm install

# Instalar dependencias de Amplify Gen 2 (tiene su propio node_modules)
cd amplify && npm install && cd ..
```

---

## Comandos principales

### Desde la raíz del monorepo

```bash
npm run infra:synth       # CDK synth (validar sin deployar)
npm run infra:deploy      # Deploy infraestructura Gen 1 a AWS
npm run backend:build     # Compilar Lambda con esbuild
npm run backend:test      # Ejecutar tests (Vitest watch)
npm run backend:lint      # ESLint
npm run frontend:dev      # Dev server (Vite)
npm run frontend:build    # Build de producción
```

### Amplify Gen 2 (desde raíz o `/amplify`)

```bash
npx ampx sandbox --profile miniswimmer          # Deploy sandbox (watch mode)
npx ampx sandbox delete --profile miniswimmer   # Eliminar sandbox
npx ampx generate outputs                        # Regenerar amplify_outputs.json
npx ampx generate graphql-client-code            # Generar tipos TypeScript
```

### Backend directo

```bash
cd backend
npm run test:ci     # Tests en single run (usado en pre-commit hook)
npm run coverage    # Reporte de cobertura
npm run typecheck   # tsc --noEmit
```

---

## DynamoDB — Single-table design

| Entidad | PK | SK |
|---|---|---|
| Customer | `CUSTOMER#{id}` | `METADATA` |
| User | `USER#{id}` | `METADATA` |
| Webform | `WEBFORM#{id}` | `METADATA` |
| Webform by customer | `CUSTOMER#{customerId}` | `WEBFORM#{createdAt}#{id}` |

- **GSI1** — `GSI1PK = TYPE#STATUS`, `GSI1SK = createdAt` → listar por tipo y estado
- **GSI2** — `GSI2PK = USER#{userId}`, `GSI2SK = createdAt` → listar por usuario asignado

---

## Amplify Gen 2 — Modelos de dominio

16 schemas de dominio, todos los modelos prefijados con `v2`:

`v2Academy` · `v2Coach` · `v2Student` · `v2Course` · `v2SessionType` · `v2Enrollment` · `v2Evaluation` · `v2Users` · `v2Roles` · `v2Permissions` · `v2SupportTicket` · `v2Transaction` · `v2Expense` · `v2ShoppingCart` · `v2WorkdayReport` · `v2EmailSend`

> Las relaciones many-to-many se implementan con join tables explícitas (`v2TicketUser`, `v2RolPermissions`, etc.) — `a.manyToMany()` no está soportado en `@aws-amplify/backend` v1.21.1.

---

## Variables de entorno (Frontend)

Copiar `frontend/.env.example` a `frontend/.env.local`:

```env
VITE_AWS_REGION=us-east-2
VITE_USER_POOL_ID=us-east-2_XXXXXXXXX
VITE_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_GRAPHQL_ENDPOINT=https://XXXXXXXXXX.appsync-api.us-east-2.amazonaws.com/graphql
```

Los valores reales se obtienen de los outputs del CDK o del `amplify_outputs.json` generado por Amplify.

---

## CDK Stack Dependencies (Gen 1)

```
AuthStackV2 → DatabaseStackV2 → ApiStackV2
```

Auth exporta IDs de Cognito → Database exporta tabla ARN → API consume ambos.

---

## Documentación

| Documento | Descripción |
|---|---|
| [docs/arquitecture/](./docs/arquitecture/) | Arquitectura detallada por capa |
| [docs/runbooks/](./docs/runbooks/) | Guías paso a paso: deploy, rollback, troubleshooting |

---

## Convenciones

- Todo el código nuevo va en `amplify/` con prefijo `v2`
- No modificar `infrastructure/`, `backend/` ni `schema/schema.graphql` (producción)
- Pre-commit hook ejecuta `test:ci` + `lint` automáticamente sobre cambios en `backend/src/`
- TypeScript estricto en todas las capas
