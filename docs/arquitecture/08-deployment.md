# 08 — Deployment

## Prerrequisitos

```bash
# AWS CLI configurado con perfil
aws configure --profile mytascensores

# Variables de entorno para CDK
export AWS_PROFILE=mytascensores
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1

# Node.js 22+ instalado
node --version  # v22.x.x
npm  --version  # 10.x.x

# CDK CLI global
npm install -g aws-cdk
cdk --version   # 2.x.x
```

## Estructura de environments

```
stage=dev    → rama de desarrollo, recursos destruibles
stage=prod   → rama de producción, recursos protegidos (RETAIN)
```

La detección de entorno se basa en el contexto CDK `-c stage=dev`.

## Primera vez (bootstrap)

```bash
# Bootstrap CDK en la cuenta/región (solo se hace una vez)
cd infrastructure
npm install
npx cdk bootstrap aws://{ACCOUNT_ID}/us-east-1 --profile mytascensores
```

## Flujo de deploy completo

### 1. Compilar el backend

```bash
cd backend
npm install
npm run build       # genera dist/index.js con esbuild
```

### 2. Deploy de infraestructura

```bash
cd infrastructure
npm install

# Ver qué va a cambiar
npm run diff -- -c stage=dev

# Deploy de los 3 stacks
npm run deploy -- -c stage=dev

# Output esperado:
# ✅  mytascensores-backoffice-auth-dev
# ✅  mytascensores-backoffice-database-dev
# ✅  mytascensores-backoffice-api-dev
#
# Outputs:
#   UserPoolId:         us-east-1_XXXXXXXXX
#   UserPoolClientId:   XXXXXXXXXXXXXXXXXXXXXXXXXX
#   GraphqlApiUrl:      https://XXXXXXXXXX.appsync-api.us-east-1.amazonaws.com/graphql
#   TableName:          mytascensores-backoffice-dev
```

### 3. Configurar el frontend

```bash
# Copiar los outputs del CDK al .env.local
cp frontend/.env.example frontend/.env.local

# Editar con los valores reales del output
nano frontend/.env.local
```

```bash
VITE_AWS_REGION=us-east-1
VITE_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_GRAPHQL_ENDPOINT=https://XXXXXXXXXX.appsync-api.us-east-1.amazonaws.com/graphql
```

### 4. Desarrollo frontend local

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

## Deploy de producción

```bash
# Build backend
cd backend && npm run build

# Deploy prod (sin confirmación interactiva)
cd infrastructure
npm run deploy -- -c stage=prod

# Build frontend
cd frontend
npm run build   # genera frontend/dist/
```

## Actualizar solo el backend (sin re-deploy CDK)

Si solo cambia el código Lambda (no la infraestructura):

```bash
cd backend && npm run build

# Update directo via AWS CLI (más rápido que CDK deploy)
aws lambda update-function-code \
  --function-name mytascensores-backoffice-resolver-dev \
  --zip-file fileb://dist/index.zip \
  --profile mytascensores
```

O simplemente correr `npm run deploy` — CDK detecta que solo cambió el código Lambda.

## Destruir environment de desarrollo

```bash
cd infrastructure
npm run destroy -- -c stage=dev

# ⚠️  NO destruir prod — tiene removalPolicy: RETAIN
```

## Diagrama de deploy pipeline (manual)

```
Developer
  │
  ├─ 1. git commit (Husky corre tests)
  │
  ├─ 2. cd backend && npm run build
  │        └─ esbuild → dist/index.js
  │
  ├─ 3. cd infrastructure && npm run deploy -- -c stage=dev
  │        ├─ AuthStack  (si cambió)
  │        ├─ DatabaseStack (si cambió)
  │        └─ ApiStack (siempre — nuevo código Lambda)
  │
  ├─ 4. Copiar outputs CDK → frontend/.env.local
  │
  └─ 5. cd frontend && npm run dev | npm run build
```

## Monorepo — comandos desde la raíz

```bash
# Desde /BACKOFFICE (raíz del monorepo)
npm run backend:build     # compila backend
npm run backend:test      # corre tests del backend
npm run backend:lint      # lint del backend
npm run frontend:dev      # servidor de desarrollo
npm run frontend:build    # build de producción
npm run infra:synth       # sintetiza CloudFormation
npm run infra:deploy      # deploy completo
```

## Variables de entorno en Lambda

Configuradas automáticamente por CDK en `api-stack.ts`:

```typescript
environment: {
  TABLE_NAME:              table.tableName,   // nombre real de la tabla
  STAGE:                   stage,             // "dev" | "prod"
  LOG_LEVEL:               "3",              // INFO por defecto
  POWERTOOLS_SERVICE_NAME: appName,
}
```

Agregar `USER_POOL_ID` (pendiente):
```typescript
USER_POOL_ID: userPool.userPoolId,
```

## Verificar el deploy

```bash
# Listar las funciones Lambda
aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName, 'mytascensores')].[FunctionName,LastModified]" \
  --output table \
  --profile mytascensores

# Ver logs recientes del resolver Lambda
aws logs tail /aws/lambda/mytascensores-backoffice-resolver-dev \
  --follow \
  --profile mytascensores

# Test directo de una query GraphQL
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {JWT_TOKEN}" \
  -d '{"query":"{ listCustomers { items { id companyName } } }"}' \
  https://XXXXXXXXXX.appsync-api.us-east-1.amazonaws.com/graphql
```

## Costos estimados (dev environment, uso bajo)

```
AppSync:   $4 / millón de queries          → < $1/mes en desarrollo
Lambda:    $0.20 / millón de invocaciones  → < $1/mes
DynamoDB:  $1.25 / millón de write units   → < $1/mes
Cognito:   gratis hasta 50,000 MAU
CloudWatch:gratis hasta 5 GB logs/mes
─────────────────────────────────────────
Total dev: ~ $0–5 / mes
```

## Checklist de deploy a producción

```
[ ] npm run backend:test        → todos los tests pasan
[ ] npm run backend:lint        → sin errores de lint
[ ] npm run typecheck           → sin errores de TypeScript
[ ] npm run backend:build       → bundle generado sin errores
[ ] npm run infra:diff          → revisar cambios de infraestructura
[ ] npm run infra:deploy -- -c stage=prod
[ ] Verificar CloudWatch logs   → sin errores post-deploy
[ ] Test smoke de queries GraphQL
[ ] Verificar frontend build    → npm run frontend:build
```
