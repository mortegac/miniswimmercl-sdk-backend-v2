# RB-09 — Troubleshooting

Errores frecuentes durante el deploy y sus soluciones.

---

## Índice rápido

| Error | Ir a |
|-------|------|
| `backend/dist/index.js does not exist` | [E-01](#e-01--bundle-no-existe) |
| `CDK bootstrap required` | [E-02](#e-02--cdk-bootstrap-no-hecho) |
| Lambda `errorType: Runtime.ImportModuleError` | [E-03](#e-03--lambda-import-error) |
| Lambda `Task timed out` | [E-04](#e-04--lambda-timeout) |
| AppSync `Unauthorized` | [E-05](#e-05--appsync-unauthorized) |
| AppSync `No resolver found` | [E-06](#e-06--resolver-no-encontrado) |
| DynamoDB `ConditionalCheckFailedException` | [E-07](#e-07--dynamodb-conditional-check) |
| DynamoDB `ResourceNotFoundException` | [E-08](#e-08--dynamodb-tabla-no-existe) |
| Cognito `UserNotFoundException` | [E-09](#e-09--cognito-user-not-found) |
| Cognito `NotAuthorizedException` | [E-10](#e-10--cognito-not-authorized) |
| CDK `Export ... cannot be deleted` | [E-11](#e-11--cdk-export-en-uso) |
| `npm install` falla en workspaces | [E-12](#e-12--npm-workspaces-error) |
| Frontend: `global is not defined` | [E-13](#e-13--global-not-defined-vite) |
| Frontend: CORS en AppSync | [E-14](#e-14--cors-appsync) |

---

## E-01 — Bundle no existe

**Error:**
```
Error: ENOENT: no such file or directory, stat '.../backend/dist/index.js'
(during CDK deploy of ApiStack)
```

**Causa:** El backend no fue compilado antes del deploy.

**Solución:**
```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/backend
npm run build
ls -lh dist/index.js  # verificar que existe
cd ../infrastructure
npx cdk deploy ... # repetir el deploy
```

---

## E-02 — CDK Bootstrap no hecho

**Error:**
```
Error: This stack uses assets, so the toolkit stack must be deployed to the environment
(Run "cdk bootstrap aws://ACCOUNT/REGION")
```

**Solución:**
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile mytascensores)
cd infrastructure
npx cdk bootstrap aws://$ACCOUNT_ID/us-east-1 --profile mytascensores
```

---

## E-03 — Lambda Import Error

**Error en CloudWatch:**
```json
{"errorType":"Runtime.ImportModuleError","errorMessage":"Error: Cannot find module 'ulid'"}
```

**Causa:** El bundle no incluye la dependencia o fue compilado incorrectamente.

**Diagnóstico:**
```bash
# Verificar que el bundle existe y tiene tamaño razonable
ls -lh backend/dist/index.js
# Debe ser > 50KB. Si es 0 bytes o muy pequeño, la compilación falló.

# Re-compilar
cd backend
npm install  # asegurar que ulid está instalado
npm run build
```

**Si el error persiste:**
```bash
# Verificar que ulid aparece en el bundle
grep -c "ulid" backend/dist/index.js
# Debe ser > 0
```

---

## E-04 — Lambda Timeout

**Error en CloudWatch:**
```
Task timed out after 30.00 seconds
```

**Causa:** Una operación DynamoDB o Cognito tardó más de 30 segundos.

**Diagnóstico:**
```bash
# Ver los logs completos del timeout
aws logs filter-log-events \
  --log-group-name /aws/lambda/mytascensores-backoffice-resolver-dev \
  --filter-pattern "Task timed out" \
  --profile mytascensores
```

**Soluciones:**
1. Si es DynamoDB: revisar que el GSI está en estado ACTIVE
2. Si es Cognito: el servicio puede tener latencia alta, revisar el AWS Status
3. Aumentar el timeout en `api-stack.ts`:
   ```typescript
   timeout: cdk.Duration.seconds(60),  // subir de 30 a 60
   ```
4. Optimizar la query (evitar `listWebforms` con múltiples queries paralelas en dev)

---

## E-05 — AppSync Unauthorized

**Error en la respuesta GraphQL:**
```json
{"errors":[{"message":"Unauthorized","errorType":"Unauthorized"}]}
```

**Causas posibles:**

**A) JWT expirado** — el token de Cognito duró más de 1 hora
```bash
# Solución: logout + login en el frontend. Amplify renueva automáticamente.
```

**B) User Pool ID incorrecto en AppSync**
```bash
# Verificar que el AppSync apunta al User Pool correcto
API_ID=$(aws appsync list-graphql-apis \
  --query "graphqlApis[?name=='mytascensores-backoffice-dev'].apiId" \
  --output text --profile mytascensores)

aws appsync get-graphql-api \
  --api-id $API_ID \
  --query "graphqlApi.userPoolConfig" \
  --profile mytascensores
```

**C) El endpoint en `.env.local` es incorrecto**
```bash
cat frontend/.env.local
# Comparar VITE_GRAPHQL_ENDPOINT con el output de CloudFormation
```

---

## E-06 — Resolver no encontrado

**Error en CloudWatch Lambda:**
```
Error: No resolver found for Query.listCustomers
```

**Causa:** El campo existe en el schema pero el dispatcher (`index.ts`) no tiene ese
handler registrado, o el Lambda fue desplegado antes de actualizar `index.ts`.

**Solución:**
```bash
# Verificar que el campo está en el resolverMap de src/index.ts
grep "listCustomers" backend/src/index.ts

# Si no está, agregar al resolverMap y re-desplegar
cd backend && npm run build
cd ../infrastructure
npx cdk deploy mytascensores-backoffice-api-dev \
  --profile mytascensores --context stage=dev --require-approval never
```

---

## E-07 — DynamoDB ConditionalCheckFailed

**Error en CloudWatch:**
```json
{"errorType":"ConditionalCheckFailedException","errorMessage":"The conditional request failed"}
```

**Causa:** Se intentó hacer `updateItem` o `deleteItem` sobre un item que no existe.
La condición `attribute_exists(PK)` falló.

**Diagnóstico:**
```bash
# Verificar si el item existe en DynamoDB
aws dynamodb get-item \
  --table-name mytascensores-backoffice-dev \
  --key '{"PK":{"S":"CUSTOMER#01J..."},"SK":{"S":"METADATA"}}' \
  --profile mytascensores
```

**Causa raíz común:** Se está usando un ID que no existe (typo, ID de otro stage, etc.).

---

## E-08 — DynamoDB Tabla no existe

**Error:**
```
ResourceNotFoundException: Requested resource not found: Table: mytascensores-backoffice-dev not found
```

**Causa:** La Lambda tiene `TABLE_NAME` incorrecto o el stack de database no fue desplegado.

**Diagnóstico:**
```bash
# Verificar que la tabla existe
aws dynamodb list-tables \
  --query "TableNames[?contains(@,'mytascensores')]" \
  --output table \
  --profile mytascensores

# Verificar el env var de la Lambda
aws lambda get-function-configuration \
  --function-name mytascensores-backoffice-resolver-dev \
  --query "Environment.Variables.TABLE_NAME" \
  --output text \
  --profile mytascensores
```

**Solución:** Si la tabla no existe, desplegar el DatabaseStack primero:
```bash
cd infrastructure
npx cdk deploy mytascensores-backoffice-database-dev \
  --profile mytascensores --context stage=dev --require-approval never
```

---

## E-09 — Cognito UserNotFoundException

**Error en CloudWatch:**
```json
{"errorMessage":"User does not exist."}
```

**Causa:** Se intenta hacer una operación sobre un usuario que no existe en Cognito
(usuario eliminado, ID incorrecto, o buscando en el User Pool equivocado).

**Diagnóstico:**
```bash
# Verificar que USER_POOL_ID en Lambda es el correcto
aws lambda get-function-configuration \
  --function-name mytascensores-backoffice-resolver-dev \
  --query "Environment.Variables.USER_POOL_ID" \
  --output text \
  --profile mytascensores

# Comparar con el output del AuthStack
aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-auth-dev \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text \
  --profile mytascensores

# Si son diferentes: actualizar USER_POOL_ID en api-stack.ts y re-deploy
```

---

## E-10 — Cognito NotAuthorizedException

**Error al crear usuario:**
```json
{"errorMessage":"Password did not conform with policy: ..."}
```

**Causa:** La contraseña temporal no cumple la política del User Pool.

**Política requerida:**
- Mínimo 8 caracteres
- Al menos 1 mayúscula
- Al menos 1 dígito
- Al menos 1 símbolo

**Contraseña válida de ejemplo:** `Temp@2026!`

---

## E-11 — CDK Export en uso

**Error durante `cdk destroy`:**
```
Export mytascensores-backoffice-dev-UserPoolId cannot be deleted
as it is in use by mytascensores-backoffice-api-dev
```

**Causa:** Se intenta destruir un stack que exporta valores que otro stack importa.

**Solución:** Destruir en orden inverso:
```bash
# Primero ApiStack (consume los exports)
npx cdk destroy mytascensores-backoffice-api-dev \
  --profile mytascensores --context stage=dev --force

# Luego los que exportan
npx cdk destroy mytascensores-backoffice-auth-dev \
  --profile mytascensores --context stage=dev --force

npx cdk destroy mytascensores-backoffice-database-dev \
  --profile mytascensores --context stage=dev --force
```

---

## E-12 — npm workspaces error

**Error:**
```
npm ERR! notsup Unsupported engine: ...
```

**Solución:**
```bash
# Verificar versiones
node --version   # debe ser >= 22
npm --version    # debe ser >= 10

# Limpiar y reinstalar
rm -rf node_modules backend/node_modules frontend/node_modules infrastructure/node_modules
npm install
```

---

## E-13 — global is not defined (Vite)

**Error en el browser:**
```
ReferenceError: global is not defined
```

**Causa:** `aws-amplify` usa `global` de Node.js, que no existe en el browser.

**Verificar `vite.config.ts`:**
```typescript
export default defineConfig({
  // ...
  define: {
    global: "globalThis",   // ← debe estar presente
  },
});
```

Si no está, agregarlo y reiniciar `npm run dev`.

---

## E-14 — CORS en AppSync

**Error en el browser:**
```
Access to fetch at 'https://xxx.appsync-api...' has been blocked by CORS policy
```

**Causa:** AppSync managed por AWS ya incluye los headers CORS correctos.
Este error usualmente indica que:
1. El endpoint en `.env.local` tiene un typo
2. Se está usando `fetch` directo en vez de `aws-amplify`

**Verificar:**
```bash
# El endpoint debe terminar en /graphql
echo $VITE_GRAPHQL_ENDPOINT
# ✅ https://xxxxxxxxxx.appsync-api.us-east-1.amazonaws.com/graphql

# En el código, usar SIEMPRE el cliente de Amplify
import { generateClient } from "aws-amplify/api";
const client = generateClient();
# NO usar fetch() directo a AppSync
```

---

## Recopilar información para soporte

Si el problema no está cubierto aquí:

```bash
# Recopilar información de diagnóstico
echo "=== Stacks ===" && \
aws cloudformation describe-stacks \
  --query "Stacks[?contains(StackName,'mytascensores')].{Stack:StackName,Status:StackStatus}" \
  --output table --profile mytascensores

echo "=== Lambda ===" && \
aws lambda get-function-configuration \
  --function-name mytascensores-backoffice-resolver-dev \
  --query "{State:State,Runtime:Runtime,Env:Environment.Variables}" \
  --profile mytascensores

echo "=== Últimos logs Lambda ===" && \
aws logs tail \
  /aws/lambda/mytascensores-backoffice-resolver-dev \
  --since 15m \
  --profile mytascensores

echo "=== DynamoDB ===" && \
aws dynamodb describe-table \
  --table-name mytascensores-backoffice-dev \
  --query "Table.{Status:TableStatus,GSI:GlobalSecondaryIndexes[*].{Name:IndexName,Status:IndexStatus}}" \
  --profile mytascensores
```
