# RB-02 — Primer Deploy Completo (desde cero)

**Cuándo usar:** Primera vez que se despliega el proyecto en una cuenta AWS o en un stage nuevo.
**Prerrequisito:** [RB-01](./RB-01-prerequisitos.md) completado.
**Tiempo estimado:** 15–25 minutos.

---

## Resumen del flujo

```
1. Obtener Account ID
2. CDK Bootstrap (una sola vez por cuenta/región)
3. Compilar el backend   ← DEBE ser antes del CDK deploy
4. Deploy AuthStack
5. Deploy DatabaseStack
6. Deploy ApiStack
7. Recoger outputs
8. Configurar frontend .env.local
9. Crear primer usuario admin  → RB-05
10. Verificar → RB-07
```

---

## Paso 1 — Obtener Account ID y Region

```bash
export AWS_PROFILE=mytascensores
export AWS_REGION=us-east-1

# Obtener Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"
```

Anotar el valor. Se usa en el bootstrap.

---

## Paso 2 — CDK Bootstrap

El bootstrap crea recursos necesarios para CDK en la cuenta (bucket S3, roles IAM).
**Solo se ejecuta una vez por cuenta + región.**

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/infrastructure

npx cdk bootstrap \
  aws://$ACCOUNT_ID/$AWS_REGION \
  --profile mytascensores

# Output esperado:
# ⏳  Bootstrapping environment aws://123456789012/us-east-1...
# ✅  Environment aws://123456789012/us-east-1 bootstrapped.
```

Si el bootstrap ya fue hecho anteriormente, este paso es seguro de repetir.

---

## Paso 3 — Compilar el backend

⚠️ **Crítico:** El CDK lee el bundle compilado desde `backend/dist/index.js`.
Si este archivo no existe, el deploy falla.

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/backend

# Instalar dependencias si no están
npm install

# Compilar
npm run build

# Verificar que el bundle existe y tiene contenido
ls -lh dist/index.js
# Esperado: -rw-r--r-- ... 150K ... dist/index.js (tamaño aproximado)

# Verificar que no es un archivo vacío
head -c 100 dist/index.js | cat
# Esperado: "use strict"; ... (código minificado)
```

---

## Paso 4 — Previsualizar los cambios (opcional pero recomendado)

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/infrastructure

npx cdk diff \
  --profile mytascensores \
  --context stage=dev

# Muestra todos los recursos que se van a crear
```

---

## Paso 5 — Deploy de los 3 stacks

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/infrastructure

npx cdk deploy --all \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never

# --require-approval never evita confirmaciones interactivas
# Quitar esta flag para confirmar manualmente cada cambio IAM
```

### Orden de deploy automático (CDK lo resuelve por las dependencias declaradas)

```
1/3  mytascensores-backoffice-auth-dev        (~3 min)
       → Cognito User Pool
       → 4 grupos (ADMIN, TECHNICIAN, SALES, VIEWER)
       → App Client

2/3  mytascensores-backoffice-database-dev    (~2 min)
       → DynamoDB Table
       → GSI1 (type + status)
       → GSI2 (assigned user)

3/3  mytascensores-backoffice-api-dev         (~5 min)
       → Lambda Function (sube dist/index.js)
       → IAM Role + permisos DynamoDB + Cognito
       → AppSync API
       → 18 resolvers conectados al Lambda
```

### Output esperado al terminar

```
✅  mytascensores-backoffice-auth-dev

Outputs:
mytascensores-backoffice-auth-dev.UserPoolId = us-east-1_AbCdEfGhI
mytascensores-backoffice-auth-dev.UserPoolClientId = 1abc2defghijklmnopqrstuvwx

✅  mytascensores-backoffice-database-dev

Outputs:
mytascensores-backoffice-database-dev.TableName = mytascensores-backoffice-dev
mytascensores-backoffice-database-dev.TableArn  = arn:aws:dynamodb:us-east-1:...

✅  mytascensores-backoffice-api-dev

Outputs:
mytascensores-backoffice-api-dev.GraphqlApiUrl = https://xxxxxxxxxx.appsync-api.us-east-1.amazonaws.com/graphql
mytascensores-backoffice-api-dev.GraphqlApiId  = xxxxxxxxxxxxxxxxx
```

---

## Paso 6 — Recoger y guardar los outputs

Ejecutar para capturar todos los outputs en variables:

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/infrastructure

# Capturar outputs del stack de auth
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-auth-dev \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text \
  --profile mytascensores)

USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-auth-dev \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text \
  --profile mytascensores)

# Capturar outputs del stack de API
GRAPHQL_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-api-dev \
  --query "Stacks[0].Outputs[?OutputKey=='GraphqlApiUrl'].OutputValue" \
  --output text \
  --profile mytascensores)

# Verificar
echo "USER_POOL_ID:        $USER_POOL_ID"
echo "USER_POOL_CLIENT_ID: $USER_POOL_CLIENT_ID"
echo "GRAPHQL_ENDPOINT:    $GRAPHQL_ENDPOINT"
```

---

## Paso 7 — Agregar USER_POOL_ID a la Lambda

⚠️ **Variable faltante:** El stack actual no inyecta `USER_POOL_ID` en la Lambda.
Esto es necesario para que los resolvers de User puedan llamar a Cognito Admin API.

Actualizar `infrastructure/lib/stacks/api-stack.ts`, sección `environment`:

```typescript
environment: {
  TABLE_NAME:              table.tableName,
  STAGE:                   stage,
  POWERTOOLS_SERVICE_NAME: appName,
  LOG_LEVEL:               stage === "prod" ? "2" : "4",
  USER_POOL_ID:            userPool.userPoolId,   // ← agregar esta línea
},
```

Luego volver a compilar y re-deploy del ApiStack:
```bash
cd backend && npm run build
cd ../infrastructure && npx cdk deploy mytascensores-backoffice-api-dev \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never
```

---

## Paso 8 — Configurar el frontend

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE

# Crear .env.local a partir del template
cp frontend/.env.example frontend/.env.local

# Escribir los valores reales (reemplaza las variables con los valores del Paso 6)
cat > frontend/.env.local << EOF
VITE_AWS_REGION=us-east-1
VITE_USER_POOL_ID=$USER_POOL_ID
VITE_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
VITE_GRAPHQL_ENDPOINT=$GRAPHQL_ENDPOINT
EOF

# Verificar el contenido
cat frontend/.env.local
```

---

## Paso 9 — Verificar infraestructura creada en AWS

```bash
# Listar stacks desplegados
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName, 'mytascensores')].{Name:StackName,Status:StackStatus}" \
  --output table \
  --profile mytascensores

# Verificar la tabla DynamoDB
aws dynamodb describe-table \
  --table-name mytascensores-backoffice-dev \
  --query "Table.{Status:TableStatus,Items:ItemCount,BillingMode:BillingModeSummary.BillingMode}" \
  --output table \
  --profile mytascensores

# Verificar la función Lambda
aws lambda get-function \
  --function-name mytascensores-backoffice-resolver-dev \
  --query "Configuration.{State:State,Runtime:Runtime,Memory:MemorySize,Timeout:Timeout}" \
  --output table \
  --profile mytascensores
```

---

## Paso 10 — Probar el frontend localmente

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/frontend

npm install
npm run dev

# Abrir: http://localhost:5173
# Debe mostrar el login de Cognito (Amplify Authenticator)
```

---

## Continuar con

- [RB-05 — Crear primer usuario admin](./RB-05-primer-usuario-admin.md)
- [RB-07 — Verificación post-deploy](./RB-07-verificacion.md)

---

## Si algo falla

Ver [RB-09 — Troubleshooting](./RB-09-troubleshooting.md).

Para destruir todo y empezar de nuevo (solo en dev):
```bash
# ⚠️ Destruye TODOS los recursos del stage dev
cd infrastructure
npx cdk destroy --all \
  --profile mytascensores \
  --context stage=dev \
  --force
```
