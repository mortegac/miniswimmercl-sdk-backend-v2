# 01 — Visión General

## Diagrama de sistema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENTE (Browser)                                │
│                                                                             │
│   ┌─────────────────────────────────────────────────────┐                  │
│   │         React 19 + Redux Toolkit + Vite             │                  │
│   │                                                     │                  │
│   │   ┌──────────┐   ┌──────────┐   ┌───────────────┐  │                  │
│   │   │  Pages   │   │  Store   │   │  GraphQL API  │  │                  │
│   │   │          │──▶│  Redux   │──▶│  aws-amplify  │  │                  │
│   │   │ Customer │   │  Slices  │   │  generateCli  │  │                  │
│   │   │ Webform  │   │  Thunks  │   │  ent()        │  │                  │
│   │   │ User     │   │          │   │               │  │                  │
│   │   └──────────┘   └──────────┘   └───────┬───────┘  │                  │
│   └───────────────────────────────────────────┼─────────┘                  │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                │ HTTPS / WSS
                                                │ (Queries, Mutations,
                                                │  Subscriptions)
┌───────────────────────────────────────────────┼─────────────────────────────┐
│                          AWS Cloud            │                             │
│                                               ▼                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    AWS Cognito User Pool                            │   │
│   │   Groups: ADMIN | TECHNICIAN | SALES | VIEWER                      │   │
│   │   Triggers: preSignUp → postConfirmation                           │   │
│   └──────────────────────────────┬──────────────────────────────────────┘   │
│                                  │ JWT Token validation                     │
│                                  ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      AWS AppSync (GraphQL)                          │   │
│   │                                                                     │   │
│   │   Auth: Cognito UserPool (default) + IAM (adicional)               │   │
│   │   Schema: Customer | User | Webform                                │   │
│   │   Logging: CloudWatch (field-level)                                │   │
│   │   Tracing: AWS X-Ray                                               │   │
│   └──────────────────────────────┬──────────────────────────────────────┘   │
│                                  │ Invoke                                   │
│                                  ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    AWS Lambda (Node.js 22)                          │   │
│   │                                                                     │   │
│   │   handler(event) → resolverMap[type.field] → resolver(event)       │   │
│   │                                                                     │   │
│   │   ┌────────────┐  ┌────────────┐  ┌────────────────────────────┐   │   │
│   │   │  Customer  │  │    User    │  │         Webform            │   │   │
│   │   │  handler   │  │  handler   │  │         handler            │   │   │
│   │   └─────┬──────┘  └─────┬──────┘  └────────────┬───────────────┘   │   │
│   │         │               │                       │                   │   │
│   │         └───────────────┴───────────────────────┘                   │   │
│   │                             │                                       │   │
│   │               RepositoryFactory (CRUD tipado)                       │   │
│   │               Logger singleton (structured logging)                 │   │
│   │               throwError (error handling centralizado)              │   │
│   └──────────────────────────────┬──────────────────────────────────────┘   │
│                                  │                        │                 │
│                     DynamoDB SDK v3                Cognito Admin API        │
│                                  │                        │                 │
│                                  ▼                        ▼                 │
│   ┌──────────────────────────────────┐  ┌────────────────────────────────┐  │
│   │   AWS DynamoDB (Single Table)    │  │  AWS Cognito (Admin ops)       │  │
│   │                                  │  │                                │  │
│   │   Table: mytascensores-{stage}   │  │  AdminCreateUser               │  │
│   │   GSI1: type + status index      │  │  AdminAddUserToGroup           │  │
│   │   GSI2: assigned user index      │  │  AdminDisableUser              │  │
│   │   Stream: NEW_AND_OLD_IMAGES     │  │                                │  │
│   └──────────────────────────────────┘  └────────────────────────────────┘  │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    AWS CloudWatch + X-Ray                           │   │
│   │   Structured JSON logs | Traces | Metrics                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Capas de la aplicación

```
┌─────────────────────────────────────────────────────┐
│  1. Presentación (frontend/)                        │
│     React pages, components, Redux slices           │
├─────────────────────────────────────────────────────┤
│  2. API Contract (schema/schema.graphql)             │
│     GraphQL types, queries, mutations, subscriptions│
├─────────────────────────────────────────────────────┤
│  3. API Gateway (AWS AppSync)                        │
│     Auth, routing, subscriptions real-time          │
├─────────────────────────────────────────────────────┤
│  4. Lógica de negocio (backend/src/resolvers/)       │
│     Handlers por entidad, reglas de negocio         │
├─────────────────────────────────────────────────────┤
│  5. Acceso a datos (backend/src/util/db/)            │
│     RepositoryFactory, client DynamoDB              │
├─────────────────────────────────────────────────────┤
│  6. Persistencia (AWS DynamoDB)                      │
│     Single-table, sin ORM, acceso O(1)              │
├─────────────────────────────────────────────────────┤
│  7. Infraestructura (infrastructure/)                │
│     CDK stacks: auth, database, api                 │
└─────────────────────────────────────────────────────┘
```

## Flujo de datos — Query

```
Browser
  │
  ├─ 1. Amplify generateClient().graphql({ query: LIST_CUSTOMERS })
  │
  ▼
AppSync
  │
  ├─ 2. Valida JWT token contra Cognito User Pool
  ├─ 3. Verifica que el campo existe en el schema
  │
  ▼
Lambda (handler.ts)
  │
  ├─ 4. logger.setContext({ operation, userId, requestId })
  ├─ 5. resolverMap["Query.listCustomers"](event)
  │
  ▼
customer/handler.ts
  │
  ├─ 6. customerRepo.query({ IndexName: "GSI1", ... })
  │
  ▼
RepositoryFactory → util/db/client.ts
  │
  ├─ 7. docClient.send(new QueryCommand({ ... }))
  │
  ▼
DynamoDB
  │
  └─ 8. Retorna items → fromRecord() → dominio limpio → AppSync → Browser
```

## Flujo de datos — Mutation con Cognito

```
Browser → AppSync → Lambda → user/handler.ts
  │
  ├─ 1. Cognito: AdminCreateUser
  ├─ 2. Cognito: AdminAddUserToGroup
  ├─ 3. DynamoDB: putItem (con cognitoId real)
  └─ 4. Retorna User domain object
```

## Decisiones arquitectónicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| AWS AppSync | Apollo Server en Lambda/ECS | Managed service, subscriptions nativas, auth Cognito sin código |
| DynamoDB single-table | RDS PostgreSQL / múltiples tablas | Costo serverless, latencia O(1), sin joins |
| Lambda único dispatcher | Lambda por resolver (Amplify style) | Deploy simple, menor cold start, bundle único |
| CDK TypeScript | SAM / Terraform / Serverless Framework | Type safety en infraestructura, mismo lenguaje que el código |
| `ulid` para IDs | UUID v4 | Ordenable por tiempo, más compacto |
| Cognito self-signup OFF | Self-signup habilitado | Backoffice interno, solo admins crean usuarios |
| `esbuild` | `tsc` directo | Bundle size mínimo, tree-shaking, path alias resolution |
