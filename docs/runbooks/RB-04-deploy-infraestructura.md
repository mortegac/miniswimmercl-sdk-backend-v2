# RB-04 — Deploy de Infraestructura (CDK)

**Cuándo usar:** Cambios en stacks CDK, schema GraphQL, configuración de DynamoDB,
Cognito, AppSync, variables de entorno Lambda, o cualquier recurso de infraestructura.
**Tiempo estimado:** 5–15 minutos dependiendo del stack afectado.

---

## Qué stack tocar según el cambio

| Cambio | Stack afectado | Tiempo aprox. |
|--------|---------------|---------------|
| `schema/schema.graphql` | `api` | 5 min |
| Env vars de Lambda | `api` | 3 min |
| Nuevo resolver en `api-stack.ts` | `api` | 5 min |
| `auth-stack.ts` (Cognito config) | `auth` | 4 min |
| `database-stack.ts` (GSI nuevo) | `database` | 3–8 min |
| Cambios en múltiples stacks | `--all` | 10–15 min |

---

## Paso 1 — Compilar el backend (siempre primero)

El stack `api` carga el bundle desde `backend/dist/index.js`.
Aunque no cambió código backend, el CDK verifica el hash del asset.

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/backend

npm run test       # no deploy si hay tests rotos
npm run build      # genera dist/index.js

ls -lh dist/index.js  # verificar que existe
```

---

## Paso 2 — Previsualizar cambios

**Siempre** ver el diff antes de aplicar:

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/infrastructure

# Ver cambios en un stack específico
npx cdk diff mytascensores-backoffice-api-dev \
  --profile mytascensores \
  --context stage=dev

# Ver cambios en todos los stacks
npx cdk diff --all \
  --profile mytascensores \
  --context stage=dev
```

### Interpretar el diff

```
[+] Resource nuevo
[-] Resource eliminado   ← ⚠️ verificar que es intencional
[~] Resource modificado
```

Prestar especial atención a:
- Eliminación de tablas DynamoDB `[-] AWS::DynamoDB::Table`
- Cambios en Cognito User Pool que pueden afectar usuarios existentes
- Cambios en políticas IAM

---

## Paso 3 — Deploy selectivo por stack

### Solo AuthStack

```bash
npx cdk deploy mytascensores-backoffice-auth-dev \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never
```

⚠️ Cambios en Cognito User Pool son **destructivos en algunos casos**.
Revisar siempre el diff antes.

### Solo DatabaseStack

```bash
npx cdk deploy mytascensores-backoffice-database-dev \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never
```

⚠️ Agregar un GSI puede tardar varios minutos. La tabla permanece disponible.
⚠️ Cambiar el tipo de atributo PK/SK requiere recrear la tabla (pérdida de datos en dev).

### Solo ApiStack

```bash
npx cdk deploy mytascensores-backoffice-api-dev \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never
```

### Todos los stacks

```bash
npx cdk deploy --all \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never
```

---

## Paso 4 — Cambios que requieren confirmación manual

Algunos cambios tienen impacto en seguridad o datos. CDK pedirá confirmación
interactiva (no usar `--require-approval never` para estos):

```bash
# Con confirmación manual para cambios IAM/seguridad
npx cdk deploy --all \
  --profile mytascensores \
  --context stage=dev
  # → Mostrará los cambios IAM y pedirá "y/n"
```

Casos que requieren confirmación:
- Nuevas políticas IAM amplias
- Cambios en roles con permisos de admin
- Cambios en políticas de bucket S3 del bootstrap

---

## Paso 5 — Actualizar el schema GraphQL

Si se modifica `schema/schema.graphql`:

```bash
# 1. Modificar schema/schema.graphql
# 2. Verificar sintaxis (no hay linter automático, revisar visualmente)

# 3. Deploy ApiStack (el schema se sube como asset)
npx cdk deploy mytascensores-backoffice-api-dev \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never

# 4. Si se agregaron campos/tipos, actualizar los resolvers en backend/src/
# 5. Compilar y re-deploy si hubo cambios en resolvers
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/backend
npm run build
cd ../infrastructure
npx cdk deploy mytascensores-backoffice-api-dev \
  --profile mytascensores --context stage=dev --require-approval never
```

---

## Paso 6 — Agregar un GSI nuevo a DynamoDB

```typescript
// En database-stack.ts, agregar:
this.table.addGlobalSecondaryIndex({
  indexName: "GSI3",
  partitionKey: { name: "GSI3PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "GSI3SK", type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

```bash
# Deploy DatabaseStack
npx cdk deploy mytascensores-backoffice-database-dev \
  --profile mytascensores --context stage=dev --require-approval never

# Monitorear el progreso del GSI (puede tardar 3-10 min)
aws dynamodb describe-table \
  --table-name mytascensores-backoffice-dev \
  --query "Table.GlobalSecondaryIndexes[*].{Name:IndexName,Status:IndexStatus}" \
  --output table \
  --profile mytascensores

# Esperar hasta que Status sea ACTIVE para todos los índices
```

---

## Paso 7 — Agregar variable de entorno a Lambda

```typescript
// En api-stack.ts, section environment:
environment: {
  TABLE_NAME:              table.tableName,
  STAGE:                   stage,
  USER_POOL_ID:            userPool.userPoolId,   // ← nueva
  LOG_LEVEL:               stage === "prod" ? "2" : "4",
  POWERTOOLS_SERVICE_NAME: appName,
},
```

```bash
# No es necesario recompilar el backend para esto
# Solo re-deploy del ApiStack
npx cdk deploy mytascensores-backoffice-api-dev \
  --profile mytascensores --context stage=dev --require-approval never

# Verificar que la variable fue seteada
aws lambda get-function-configuration \
  --function-name mytascensores-backoffice-resolver-dev \
  --query "Environment.Variables" \
  --output table \
  --profile mytascensores
```

---

## Outputs post-deploy

Después de cualquier deploy, verificar que los outputs siguen siendo accesibles:

```bash
# Todos los outputs de todos los stacks
for stack in auth database api; do
  echo "=== mytascensores-backoffice-${stack}-dev ==="
  aws cloudformation describe-stacks \
    --stack-name "mytascensores-backoffice-${stack}-dev" \
    --query "Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}" \
    --output table \
    --profile mytascensores
done
```

---

## Continuar con

- [RB-07 — Verificación post-deploy](./RB-07-verificacion.md)
