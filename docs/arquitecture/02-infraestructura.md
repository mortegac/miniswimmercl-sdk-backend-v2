# 02 — Infraestructura (AWS CDK v2)

## Visión general

Toda la infraestructura está definida como código en TypeScript usando AWS CDK v2.
No existe ningún recurso creado manualmente en la consola de AWS.

```
infrastructure/
├── bin/
│   └── app.ts           ← Entry point — instancia los 3 stacks
└── lib/
    └── stacks/
        ├── auth-stack.ts      ← Cognito User Pool + Client + Grupos
        ├── database-stack.ts  ← DynamoDB Table + GSI1 + GSI2
        └── api-stack.ts       ← AppSync + Lambda + Resolvers
```

## Stacks y dependencias

```
app.ts
  │
  ├── AuthStack         (independiente)
  │     └── exports: userPool, userPoolClient
  │
  ├── DatabaseStack     (independiente)
  │     └── exports: table
  │
  └── ApiStack          (depende de Auth + Database)
        ├── recibe: userPool, table
        └── exports: graphqlUrl, apiId
```

La dependencia explícita garantiza el orden de deploy:
```typescript
apiStack.addDependency(authStack);
apiStack.addDependency(databaseStack);
```

## AuthStack (`auth-stack.ts`)

### Recursos creados

**Cognito User Pool**
```
selfSignUpEnabled: false          // Solo admins crean usuarios
signInAliases:     { email: true }
autoVerify:        { email: true }
passwordPolicy:    8+ chars, upper, digits, symbols
accountRecovery:   EMAIL_ONLY
removalPolicy:     RETAIN (prod) | DESTROY (dev)
```

**User Pool Groups**
```
ADMIN      precedence: 1   Acceso total
TECHNICIAN precedence: 2   Técnicos
SALES      precedence: 3   Ventas
VIEWER     precedence: 4   Solo lectura
```

**App Client**
```
generateSecret:       false          // SPA sin secret
authFlows:            userPassword, userSrp, adminUserPassword
accessTokenValidity:  1 hora
idTokenValidity:      1 hora
refreshTokenValidity: 30 días
```

### Outputs exportados
```
{appName}-{stage}-UserPoolId
{appName}-{stage}-UserPoolClientId
```

## DatabaseStack (`database-stack.ts`)

### Tabla principal

```
tableName:        mytascensores-backoffice-{stage}
partitionKey:     PK (String)
sortKey:          SK (String)
billingMode:      PAY_PER_REQUEST    // sin capacidad fija
pointInTimeRecovery: true (prod)    // backup automático
encryption:       AWS_MANAGED
stream:           NEW_AND_OLD_IMAGES // para futuros triggers
ttl:              atributo "ttl"
removalPolicy:    RETAIN (prod) | DESTROY (dev)
```

### Índices secundarios globales

**GSI1** — Consultas por tipo de entidad + status/rol
```
GSI1PK (String)  →  CUSTOMER#ACTIVE | USER#ADMIN | WEBFORM#EMERGENCY#PENDING
GSI1SK (String)  →  createdAt (ISO 8601)
Projection:      ALL
```

**GSI2** — Consultas por usuario asignado / Cognito ID
```
GSI2PK (String)  →  USER#{userId} | COGNITO#{cognitoId}
GSI2SK (String)  →  createdAt
Projection:      ALL
```

### Outputs exportados
```
{appName}-{stage}-TableName
{appName}-{stage}-TableArn
```

## ApiStack (`api-stack.ts`)

### Lambda Resolver

```
runtime:       Node.js 22.x
handler:       index.handler
code:          backend/dist/index.js (bundle esbuild)
timeout:       30 segundos
memorySize:    512 MB
tracing:       ACTIVE (X-Ray)
logRetention:  1 mes

Environment variables:
  TABLE_NAME   → nombre de la tabla DynamoDB
  STAGE        → dev | prod
  LOG_LEVEL    → 3 (INFO) default
```

**Permisos IAM otorgados a la Lambda:**
- `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `Scan` → sobre la tabla principal
- `cognito-idp:AdminCreateUser`, `AdminUpdateUserAttributes`, `AdminDisableUser`, `AdminAddUserToGroup`, `ListUsers` → sobre el User Pool

### AppSync GraphQL API

```
name:           mytascensores-backoffice-{stage}
schema:         schema/schema.graphql
defaultAuth:    Cognito UserPool
additionalAuth: IAM
logging:        ALL fields → CloudWatch
xrayEnabled:    true
```

**Resolvers registrados (19 total):**
```
Query     → getCustomer, listCustomers, searchCustomers
          → getUser, getCurrentUser, listUsers
          → getWebform, listWebforms, listWebformsByCustomer

Mutation  → createCustomer, updateCustomer, deleteCustomer
          → createUser, updateUser, deactivateUser
          → createWebform, updateWebform, assignWebform
```

Todos los resolvers apuntan al mismo Lambda DataSource (dispatcher pattern).

### Outputs exportados
```
{appName}-{stage}-GraphqlApiUrl
{appName}-{stage}-GraphqlApiId
```

## Environments (stages)

```
CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION  ← variables de entorno AWS CLI
stage                                      ← contexto CDK (-c stage=dev)

dev:
  pointInTimeRecovery: false
  logRetention:        1 mes
  removalPolicy:       DESTROY

prod:
  pointInTimeRecovery: true
  logRetention:        1 mes (AppSync)
  removalPolicy:       RETAIN (Cognito + DynamoDB)
```

## Comandos CDK

```bash
# Bootstrap (primera vez por cuenta/región)
cd infrastructure
npx cdk bootstrap

# Ver cambios sin aplicar
npm run diff -- -c stage=dev

# Sintetizar CloudFormation templates
npm run synth -- -c stage=dev

# Deploy completo
npm run deploy -- -c stage=dev

# Deploy producción
npm run deploy -- -c stage=prod

# Destruir (solo dev)
npm run destroy -- -c stage=dev
```

## Naming convention de recursos

```
{appName}-{stage}-{recurso}

Ejemplos:
  mytascensores-backoffice-dev-auth-XXXX       ← Stack Cognito
  mytascensores-backoffice-dev                 ← Tabla DynamoDB
  mytascensores-backoffice-dev                 ← AppSync API
  mytascensores-backoffice-resolver-dev        ← Lambda
```
