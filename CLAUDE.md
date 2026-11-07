# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Monorepo for a swimming school backoffice (Miniswimmer). Four workspaces:
- **`infrastructure/`** — AWS CDK v2 (Cognito + DynamoDB + AppSync)
- **`backend/`** — Node.js Lambda resolver functions
- **`frontend/`** — React 19 + Vite SPA
- **`amplify/`** — Amplify Gen 2 backend (parallel V2 schema deployment)

AWS account: `995007408497` (profile: `MINISWIMMER-05FEB2026`), region: `us-east-2`.

> **IMPORTANT**: ALWAYS use AWS profile `MINISWIMMER-05FEB2026` for all AWS CLI and `ampx` commands in this project. Never use `miniswimmer` or any other profile.

## Common Commands

### Infrastructure (CDK)
```bash
cd infrastructure
npm run build        # tsc compile
npm run synth        # CDK synth (dry run)
npm run deploy       # Deploy all stacks to AWS
npm run destroy      # Destroy stacks
```

Entry: `bin/app.ts` → `bin/app-v2.ts` (V2 variant, stack name prefix: `miniswimmer-backofficev2`)

### Backend (Lambda)
```bash
cd backend
npm run build        # esbuild bundle
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run test         # Vitest (watch mode)
npm run test:ci      # Vitest (single run, used in pre-commit hook)
npm run coverage     # Coverage report
```

Run a single test file:
```bash
cd backend && npx vitest run src/path/to/file.test.ts
```

### Frontend (React + Vite)
```bash
cd frontend
npm run dev          # Vite dev server
npm run build        # Production build
npm run preview      # Preview production build
```

### Amplify Gen 2 (V2 schemas)
```bash
# From project root OR inside amplify/:
npx ampx sandbox --profile MINISWIMMER-05FEB2026        # Deploy sandbox (watches for changes)
npx ampx sandbox delete --profile MINISWIMMER-05FEB2026 # Tear down sandbox
npx ampx generate outputs                     # Regenerate amplify_outputs.json
npx ampx generate graphql-client-code         # Generate TypeScript client types
```

Shorthand scripts inside `amplify/` (after `cd amplify`):
```bash
npm run sandbox          # same as npx ampx sandbox --profile MINISWIMMER-05FEB2026
npm run generate:config  # regenerate amplify_outputs.json
npm run generate:graphql # regenerate TypeScript client types
```

## Architecture

### Two Parallel Systems

This project has **two coexisting backend systems**:

1. **Gen 1 (CDK)** — `infrastructure/` + `backend/` + `schema/schema.graphql`
   - AppSync API backed by a single Lambda resolver
   - DynamoDB single-table design with GSI1 (`type+status`) and GSI2 (`assignedUser`)
   - Stack names: `miniswimmer-backofficev2-{auth|database|api}-dev`
   - Do **not** modify to avoid breaking production

2. **Gen 2 (Amplify)** — `amplify/`
   - Amplify Gen 2 TypeScript schema definitions (`@aws-amplify/backend` v1.21.1)
   - All models and enums prefixed with `v2` (e.g., `v2Users`, `v2Student`)
   - Sandbox stack: `amplify-backoffice-v2sdkbackend-sandbox-2d9df2bc3d`
   - AppSync endpoint (sandbox): `https://qpkai7hiqjewdkmonvb272iucy.appsync-api.us-east-2.amazonaws.com/graphql`

### CDK Stack Dependencies (Gen 1)
```
AuthStackV2 → DatabaseStackV2 → ApiStackV2
```
Auth exports Cognito pool/client IDs → Database exports table name + ARN → API consumes both.

### Amplify Gen 2 Schema Design

17 domain schema files in `amplify/data/schema/`, combined in `amplify/data/resource.ts` via `a.combine([...])`.

**Critical pattern — no `a.manyToMany()`**: This version of `@aws-amplify/backend` (v1.21.1) does not support `a.manyToMany()` or `.default()` on `a.ref()`. All many-to-many relations use explicit join tables:
- `v2TicketUser` (SupportTicket ↔ Users)
- `v2TicketComment` (SupportTicket ↔ CommentTickets)
- `v2CourseSessionType` (Course ↔ SessionType)
- `v2RolPermissions` (Roles ↔ Permissions)
- `v2UserPermissions` (Users ↔ Permissions)

Each `a.hasOne()` or `a.hasMany()` on a model **requires** a matching `a.belongsTo()` on the other side, or the CDK assembly will fail with `InvalidSchemaError: Unable to find associated relationship definition`.

**Authorization modes**: Default is `userPool`. The API key (`publicApiKey`) is only enabled for the public payment flow (Webpay mutations).

### Amplify Gen 2 Lambda Functions

All functions live under `amplify/functions/{name}/` with a `resource.ts` (defineFunction) and a `handler.ts`. The `resourceGroupName` field controls which CDK stack the Lambda is deployed into:
- `resourceGroupName: "auth"` → auth stack (use for Cognito triggers)
- `resourceGroupName: "data"` → data stack (use for everything else — avoids circular deps when referencing DynamoDB tables)

**Cross-stack IAM pattern**: Functions in the `auth` resource group cannot directly reference DynamoDB tables from `data` (circular dependency). Use wildcard ARNs in `addToRolePolicy` instead:
```ts
resources: [`arn:aws:dynamodb:${region}:${account}:table/v2Users-*`]
```

Current functions:
| Function | Trigger | Purpose |
|---|---|---|
| `postConfirmation` | Cognito PostConfirmation | Creates `v2Users` record on signup |
| `listCognitoUsers` | GraphQL query | Lists Cognito User Pool users with pagination |
| `cognitoUserMgmt` | GraphQL mutations | setPassword / setStatus / createUser in Cognito+DynamoDB |
| `dailyCleanupSessions` | EventBridge cron 11:00 UTC | Cleans up sessions, sends emails via EmailJS |
| `webpayStart` | GraphQL mutation | Initiates Transbank Webpay Plus transaction |
| `webpayCommit` | GraphQL mutation | Confirms transaction, creates enrollments |
| `webpayStatus` | GraphQL mutation | Error recovery — checks transaction status only |
| `gmailSync` | EventBridge cron 11:00 UTC + GraphQL mutation | Syncs last 7 days of Gmail inbox into `v2GmailInbox` |
| `gmailReply` | GraphQL mutation | Sends replies via Gmail API (Service Account delegation) |

**Gmail functions** use a Google Service Account stored in Secrets Manager under `miniswimmer/gmail-service-account`. The service account must have domain-wide delegation to impersonate `hola@miniswimmer.cl` and `welcome@miniswimmer.cl`.

**Webpay functions** are currently configured for Transbank **integration** (test) environment. Commerce code `597055555532` and API key are the public integration test credentials.

**Lambda build constraint**: Amplify Gen 2 functions must be CommonJS-compatible at runtime. If a Lambda handler imports ESM-only packages, you must bundle manually using `esbuild --bundle --platform=node --format=cjs` and deploy the output directly. The `amplify/` package uses `"type": "module"` for `ampx` CLI tooling, but Lambda runtimes expect CJS output.

### Backend Lambda (Gen 1)

`backend/src/index.ts` routes AppSync `fieldName` to handler functions:
- Path aliases: `@log` → `util/log.ts`, `@db` → `util/db/`, `@error` → `util/error.ts`, `@types` → `types/`
- DynamoDB access via `RepositoryFactory` pattern in `util/db/`
- Tests use Vitest; the pre-commit hook runs `test:ci` automatically

### Frontend

React 19 + Redux Toolkit + React Router 7. Authentication via AWS Amplify UI React (`@aws-amplify/ui-react`). Amplify is initialized in `frontend/src/main.tsx` using `amplify_outputs.json` (generated by `npx ampx generate outputs`).

GraphQL calls are in `frontend/src/api/graphql/` organized by mutations/queries/subscriptions.

## Key Constraints

- **Never touch Gen 1 resources** — CDK stacks and `schema/schema.graphql` are production. All new work goes in `amplify/` with the `v2` prefix.
- `amplify/` has its own `node_modules` (installed separately). Run `npm install` inside `amplify/` when adding Gen 2 dependencies.
- The `ampx` CLI requires the directory to be named exactly `amplify/` (not `amplify-gen2/` or similar).
- `ampx sandbox` deploys using the `MINISWIMMER-05FEB2026` AWS profile. The sandbox does **not** appear in AWS Amplify Console — check CloudFormation, AppSync, Cognito, and DynamoDB consoles directly.
- DynamoDB table names in sandbox follow the pattern `v2ModelName-{appId}-{env}` — always use the `TABLE_NAME` env vars injected by `backend.ts`, never hardcode table names.



### AWS CLI Profile

**Always use profile `MINISWIMMER-05FEB2026`** for all AWS CLI commands in this project:

```bash
aws <command> --profile MINISWIMMER-05FEB2026
# or
export AWS_PROFILE=MINISWIMMER-05FEB2026
```

### AWS Cognito User Pools

> **CRITICAL — LEER ANTES DE CUALQUIER OPERACIÓN EN COGNITO**
>
> - **NUNCA** modificar, crear usuarios, ni hacer ningún cambio en el pool `us-east-2_RnbT7nPr9`.
>   Es el pool de clientes de pago legacy (11 usuarios reales) y cualquier cambio puede romper flujos de pago en producción.
> - **SIEMPRE** usar el pool `us-east-2_SAkrMOGEN` para todas las operaciones. Es el pool activo referenciado en `amplify_outputs.json`.

Todos los proyectos Miniswimmer comparten este backend Amplify Gen 2. Región: `us-east-2`.

| Pool | ID | Client ID | Estado |
|---|---|---|---|
| **✅ USAR SIEMPRE** | `us-east-2_SAkrMOGEN` | `7ffvh1vqfmqhl36pjv3ugdsfg6` | Producción activa — referenciado en `amplify_outputs.json` |
| **⚠️ Solo lectura** | `us-east-2_xtGftFnff` | `6o3gk8krb9m6jb0kqkrrj86u77` | Deploy anterior — usuarios admin (`hola@miniswimmer.cl`, `hi@manuelo.dev`) |
| **🚫 NUNCA TOCAR** | `us-east-2_RnbT7nPr9` | — | Pool legacy de clientes de pago. 11 usuarios reales. Solo lectura. |
| **Dev (vacío)** | `us-east-2_g5cMGeymr` | — | Pool de desarrollo del frontend. Sin usuarios. |

```bash
# Listar usuarios del pool activo
aws cognito-idp list-users --user-pool-id us-east-2_SAkrMOGEN --profile MINISWIMMER-05FEB2026

# Buscar usuario por email
aws cognito-idp list-users \
  --user-pool-id us-east-2_SAkrMOGEN \
  --profile MINISWIMMER-05FEB2026 \
  --query 'Users[*].[Username, UserStatus, Attributes[?Name==`email`].Value | [0]]' \
  --output table

# Cambiar contraseña (quita FORCE_CHANGE_PASSWORD / RESET_REQUIRED)
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-2_SAkrMOGEN \
  --username <sub-del-usuario> \
  --password '<nueva-contraseña>' \
  --permanent \
  --profile MINISWIMMER-05FEB2026
```

---

## Deployed Infrastructure (Resource IDs)

### Gen 1 — CDK (Production)

Stack names: `miniswimmer-backofficev2-{auth|database|api}-dev`

**Cognito**
| Resource | Value |
|---|---|
| User Pool ID | `us-east-2_g5cMGeymr` |
| User Pool ARN | `arn:aws:cognito-idp:us-east-2:995007408497:userpool/us-east-2_g5cMGeymr` |
| App Client ID | `513iullpjlid02fo2gcpo7gi54` |

**DynamoDB**
| Resource | Value |
|---|---|
| Table Name | `miniswimmer-backofficev2-dev` |
| Table ARN | `arn:aws:dynamodb:us-east-2:995007408497:table/miniswimmer-backofficev2-dev` |

**AppSync**
| Resource | Value |
|---|---|
| API ID | `6xcwc6gerna3takfspui2meoqy` |
| GraphQL URL | `https://frdsmq7mejg2fc6iu25pja4e5q.appsync-api.us-east-2.amazonaws.com/graphql` |

---

### Gen 2 — Amplify Sandbox (v2sdkbackend, current)

Root stack: `amplify-backoffice-v2sdkbackend-sandbox-2d9df2bc3d`

**Cognito**
| Resource | Value |
|---|---|
| User Pool ID | `us-east-2_xtGftFnff` |
| User Pool ARN | `arn:aws:cognito-idp:us-east-2:995007408497:userpool/us-east-2_xtGftFnff` |
| App Client ID | `6o3gk8krb9m6jb0kqkrrj86u77` |
| Identity Pool ID | `us-east-2:6cc5d5a9-1507-4620-adc3-44ee8c4c1522` |

**AppSync**
| Resource | Value |
|---|---|
| API ID | `ggfytzhgxvd3pcnyj2mjkfenre` |
| API Key | `da2-sgxmlrhyxzbctc2fal33yxefy4` |
| GraphQL URL | `https://qpkai7hiqjewdkmonvb272iucy.appsync-api.us-east-2.amazonaws.com/graphql` |
| Auth modes | `AMAZON_COGNITO_USER_POOLS` (default) + `API_KEY` + `AWS_IAM` |

**Lambda Functions (deployed names)**
| Function | Deployed Lambda Name |
|---|---|
| `postConfirmation` | `amplify-backoffice-v2sdkb-postConfirmationlambda4B-wEJ3Fm9gdhGw` |
| `listCognitoUsers` | `amplify-backoffice-v2sdkb-listCognitoUserslambdaC4-D0YHtpcHRPy6` |
| `cognitoUserMgmt` | `amplify-backoffice-v2sdkb-cognitoUserMgmtlambda210-AQC1vImrSuco` |
| `generateEnrollmentV2` | `amplify-backoffice-v2sdkb-generateEnrollmentV2lamb-zufznIqUtcoi` |
| `webpayStartV2` | `amplify-backoffice-v2sdkb-webpayStartV2lambda1759A-lv38FSgzFb3c` |
| `webpayCommitV2` | `amplify-backoffice-v2sdkb-webpayCommitV2lambda120C-I91rOjFg400b` |
| `webpayStatusV2` | `amplify-backoffice-v2sdkb-webpayStatusV2lambdaE3F2-2y39qPaLWAxR` |
| `gmailSyncV2` | `amplify-backoffice-v2sdkb-gmailSyncV2lambda51C7FAA-D6ipzbIaFWHw` |
| `gmailReplyV2` | `amplify-backoffice-v2sdkb-gmailReplyV2lambda1EE4EC-zQnuAMo8Guk3` |
| `dailyCleanupSessions` | `amplify-backoffice-v2sdkb-dailyCleanupSessionslamb-yBEyiKSUhWtz` |

**S3 (Codegen Assets)**
`amplify-backoffice-v2sdkb-v2sdkbackendamplifycodeg-bvf1ax5im33w`

**Schemas excluded (CloudFormation resource limit ~2,500)**
- `v2Expense` — 38 resources
- `v2WorkdayReports` — 43 resources

To re-add: restore the schema file import in `amplify/data/resource.ts` and the `hasMany` relation in the parent model, then run `ampx sandbox --once`.



### AWS CLI Profile

> **CRITICAL:** Always use profile `MINISWIMMER-05FEB2026` for every AWS CLI command. Never run AWS CLI commands without this profile.

```bash
aws <command> --profile MINISWIMMER-05FEB2026
```

### AppSync GraphQL API — Endpoint Canónico

> **CRITICAL — ÚNICO ENDPOINT VÁLIDO PARA LOS 3 PROYECTOS**
>
> Los 3 proyectos Miniswimmer (Pagos, Backend, Backoffice) comparten el mismo endpoint AppSync.
> **NUNCA** usar ningún otro endpoint. El archivo `amplify/amplify_outputs.json` tiene un endpoint
> de sandbox/dev distinto (`4awnoywdgnbidh4drditfrb5bq`) — ignorarlo en producción.

| Campo | Valor |
|---|---|
| **GraphQL URL** | `https://vibghdaimbgfnlypijdjpufbgu.appsync-api.us-east-2.amazonaws.com/graphql` |
| **API Key** | `da2-y5mbqnzliraotj2zgojiatx34a` |
| **Región** | `us-east-2` |
| **Auth modes** | `apiKey` (operaciones públicas), `userPool` (operaciones admin) |
| **Fuente de verdad** | `amplify_outputs.json` (raíz del repo) → campo `data.url` |

```bash
# Verificar que amplify_outputs.json usa el endpoint correcto
grep "url" amplify_outputs.json
# Debe mostrar: vibghdaimbgfnlypijdjpufbgu.appsync-api.us-east-2.amazonaws.com/graphql
```

**Endpoints legacy a ignorar:**
- `amplify/amplify_outputs.json` → endpoint `4awnoywdgnbidh4drditfrb5bq` — sandbox/dev, NO es producción

## Proyectos Relacionados

Todos los proyectos comparten este backend Amplify Gen 2 y el pool Cognito `us-east-2_SAkrMOGEN`.

| Proyecto | Ruta local | CLAUDE.md |
|---|---|---|
| **Backend (este proyecto)** | `/Users/manu/_CODE/MINISWIMMER.us/_CODE/miniswimmercl-sdk-backend-v2` | `CLAUDE.md` |
| **Frontend (backoffice)** | `/Users/manu/_CODE/MINISWIMMER.us/_CODE/miniswimmercl-sdk-frontend-v2` | `CLAUDE.md` |
| **Pagos** | `/Users/manu/_CODE/MINISWIMMER.us/_CODE/miniswimmercl_paymentsV2` | `CLAUDE.md` |

### amplify_outputs.json (compartido entre proyectos)

Los 3 proyectos usan el mismo `amplify_outputs.json`. Si el backend se redespliega, copiar el nuevo archivo a los otros dos proyectos.

```bash
# Después de un redeploy del backend, actualizar los otros proyectos:
cp /Users/manu/_CODE/MINISWIMMER.us/_CODE/miniswimmercl-sdk-backend-v2/amplify_outputs.json \
   /Users/manu/_CODE/MINISWIMMER.us/_CODE/miniswimmercl-sdk-frontend-v2/amplify_outputs.json

cp /Users/manu/_CODE/MINISWIMMER.us/_CODE/miniswimmercl-sdk-backend-v2/amplify_outputs.json \
   /Users/manu/_CODE/MINISWIMMER.us/_CODE/miniswimmercl_paymentsV2/amplify_outputs.json
```


## CRITICAL
- Think before acting. Read files before writing code.
- Edit only the changes; do not rewrite entire files.
- Do not re-read files you have already read unless they have changed.
- Do not repeat unchanged code in your responses.
- No preambles, no summaries at the end, and do not explain the obvious.
- Test before completing the task.
<!-- - Piensa antes de actuar. Lee los archivos antes de escribir código
- Edita solo lo que cambia, no reescribas archivos enteros
- No releas archivos que ya hayas leído salvo que hayan cambiado
- No repitas código sin cambios en tus respuestas
- Sin preámbulos, sin resúmenes al final, sin explicar lo obvio
- Testea antes de dar por terminado -->