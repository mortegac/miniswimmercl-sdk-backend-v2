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
   - Sandbox stack: `amplify-backoffice-manu-sandbox-0b1ca78abf`
   - AppSync endpoint (sandbox): `https://4awnoywdgnbidh4drditfrb5bq.appsync-api.us-east-2.amazonaws.com/graphql`

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
