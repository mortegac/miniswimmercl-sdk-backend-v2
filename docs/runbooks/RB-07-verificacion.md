# RB-07 — Verificación Post-Deploy

**Cuándo usar:** Después de cualquier deploy (dev o prod).
Confirmar que todos los componentes del sistema están operativos.

---

## Variables necesarias

```bash
export AWS_PROFILE=mytascensores
STAGE=dev    # o prod

# Cargar outputs del stack
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-auth-$STAGE \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)

TABLE_NAME=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-database-$STAGE \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" \
  --output text)

GRAPHQL_URL=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-api-$STAGE \
  --query "Stacks[0].Outputs[?OutputKey=='GraphqlApiUrl'].OutputValue" \
  --output text)

LAMBDA_NAME="mytascensores-backoffice-resolver-$STAGE"
```

---

## 1. Verificar CloudFormation Stacks

```bash
aws cloudformation describe-stacks \
  --query "Stacks[?contains(StackName,'mytascensores-backoffice')].{Stack:StackName,Status:StackStatus}" \
  --output table

# ✅ Esperado: todos en CREATE_COMPLETE o UPDATE_COMPLETE
# ❌ Problema si: ROLLBACK_COMPLETE, UPDATE_ROLLBACK_COMPLETE, CREATE_FAILED
```

---

## 2. Verificar Lambda

```bash
# Estado y configuración
aws lambda get-function-configuration \
  --function-name $LAMBDA_NAME \
  --query "{State:State,Runtime:Runtime,Memory:MemorySize,Timeout:Timeout,LastModified:LastModified,CodeSize:CodeSize}" \
  --output table

# ✅ Esperado: State = Active, Runtime = nodejs22.x

# Variables de entorno (verificar que están todas)
aws lambda get-function-configuration \
  --function-name $LAMBDA_NAME \
  --query "Environment.Variables" \
  --output table

# ✅ Esperado: TABLE_NAME, STAGE, LOG_LEVEL, USER_POOL_ID (tras RB-02 Paso 7)
```

---

## 3. Verificar DynamoDB

```bash
# Estado de la tabla
aws dynamodb describe-table \
  --table-name $TABLE_NAME \
  --query "Table.{Status:TableStatus,Items:ItemCount,Size:TableSizeBytes}" \
  --output table

# ✅ Esperado: Status = ACTIVE

# Estado de los GSI
aws dynamodb describe-table \
  --table-name $TABLE_NAME \
  --query "Table.GlobalSecondaryIndexes[*].{Name:IndexName,Status:IndexStatus}" \
  --output table

# ✅ Esperado: GSI1 = ACTIVE, GSI2 = ACTIVE
```

---

## 4. Verificar Cognito

```bash
# User Pool activo
aws cognito-idp describe-user-pool \
  --user-pool-id $USER_POOL_ID \
  --query "UserPool.{Status:Status,Name:Name,MFA:MfaConfiguration}" \
  --output table

# ✅ Esperado: Status = ACTIVE (o no aparece, es normal en Cognito)

# Grupos existentes
aws cognito-idp list-groups \
  --user-pool-id $USER_POOL_ID \
  --query "Groups[*].{Group:GroupName,Precedence:Precedence}" \
  --output table

# ✅ Esperado: ADMIN(1), TECHNICIAN(2), SALES(3), VIEWER(4)

# Usuarios registrados
aws cognito-idp list-users \
  --user-pool-id $USER_POOL_ID \
  --query "Users[*].{Email:Username,Status:UserStatus,Enabled:Enabled}" \
  --output table
```

---

## 5. Verificar AppSync API

```bash
# API registrada
aws appsync list-graphql-apis \
  --query "graphqlApis[?name=='mytascensores-backoffice-$STAGE'].{Name:name,Id:apiId,Auth:authenticationType}" \
  --output table

# ✅ Esperado: la API aparece con authType AMAZON_COGNITO_USER_POOLS

# Obtener API ID
API_ID=$(aws appsync list-graphql-apis \
  --query "graphqlApis[?name=='mytascensores-backoffice-$STAGE'].apiId" \
  --output text)

# Verificar los resolvers registrados (deben ser 18)
aws appsync list-resolvers \
  --api-id $API_ID \
  --type-name Query \
  --query "resolvers[*].fieldName" \
  --output table

aws appsync list-resolvers \
  --api-id $API_ID \
  --type-name Mutation \
  --query "resolvers[*].fieldName" \
  --output table

# ✅ Esperado:
# Query:    getCustomer, listCustomers, searchCustomers, getUser, getCurrentUser,
#           listUsers, getWebform, listWebforms, listWebformsByCustomer
# Mutation: createCustomer, updateCustomer, deleteCustomer, createUser, updateUser,
#           deactivateUser, createWebform, updateWebform, assignWebform
```

---

## 6. Invocar la Lambda directamente

Test de invocación sin necesidad de JWT:

```bash
aws lambda invoke \
  --function-name $LAMBDA_NAME \
  --payload '{
    "typeName":  "Query",
    "fieldName": "listCustomers",
    "arguments": {"filter": {"limit": 1}},
    "identity":  {"sub": "health-check", "username": "health@check.com", "claims": {}},
    "source":    null,
    "request":   {"headers": {}, "domainName": null},
    "info":      {"fieldName": "listCustomers", "parentTypeName": "Query", "variables": {}, "selectionSetList": [], "selectionSetGraphQL": ""}
  }' \
  --cli-binary-format raw-in-base64-out \
  --log-type Tail \
  --profile mytascensores \
  /tmp/lambda-response.json

# Ver respuesta
cat /tmp/lambda-response.json

# ✅ Esperado: {"items":[],"nextToken":null}   (lista vacía si no hay datos)
# ❌ Problema si: {"errorMessage":"..."}
```

---

## 7. Verificar CloudWatch Logs

```bash
# Logs de la Lambda (últimos 5 minutos)
aws logs tail \
  /aws/lambda/$LAMBDA_NAME \
  --since 5m \
  --format short \
  --profile mytascensores

# ✅ OK: logs de invocación, INIT_START, START, END, REPORT
# ❌ Problema: ERROR, "Task timed out", "Runtime exited"

# Logs de AppSync (útil para debug de queries específicas)
API_ID=$(aws appsync list-graphql-apis \
  --query "graphqlApis[?name=='mytascensores-backoffice-$STAGE'].apiId" \
  --output text)

aws logs tail \
  /aws/appsync/apis/$API_ID \
  --since 5m \
  --format short \
  --profile mytascensores
```

---

## 8. Verificar el frontend (local)

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/frontend

# Verificar que las variables de entorno están configuradas
cat .env.local

# Iniciar el servidor de desarrollo
npm run dev
```

En el browser `http://localhost:5173`:
- [ ] Aparece el formulario de login de Cognito
- [ ] Login con credenciales admin funciona
- [ ] No aparecen errores en la consola del browser
- [ ] Red: las requests a AppSync retornan 200

---

## Resumen del checklist

```
CloudFormation
  [ ] 3 stacks en CREATE_COMPLETE o UPDATE_COMPLETE

Lambda
  [ ] State = Active
  [ ] Runtime = nodejs22.x
  [ ] Variables de entorno presentes (TABLE_NAME, USER_POOL_ID, etc.)
  [ ] Invocación directa retorna resultado válido

DynamoDB
  [ ] TableStatus = ACTIVE
  [ ] GSI1 = ACTIVE
  [ ] GSI2 = ACTIVE

Cognito
  [ ] User Pool accesible
  [ ] 4 grupos creados (ADMIN, TECHNICIAN, SALES, VIEWER)
  [ ] Al menos 1 usuario en estado CONFIRMED

AppSync
  [ ] API visible
  [ ] 9 Query resolvers registrados
  [ ] 9 Mutation resolvers registrados

Frontend
  [ ] Login exitoso
  [ ] Sin errores en consola
```
