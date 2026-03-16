# RB-03 — Deploy del Backend (solo Lambda)

**Cuándo usar:** Cambios en resolvers, lógica de negocio, o utilities.
No cambia la infraestructura (DynamoDB, Cognito, AppSync config).
**Tiempo estimado:** 2–4 minutos.

---

## Cuándo usar este runbook vs RB-04

| Cambio | Runbook |
|--------|---------|
| Código en `backend/src/` (resolvers, utils) | RB-03 (este) |
| `schema/schema.graphql` | RB-04 (infraestructura) |
| `infrastructure/lib/stacks/` | RB-04 (infraestructura) |
| Ambos | RB-04 (incluye build del backend) |

---

## Flujo

```
1. Tests pasan
2. Compilar con esbuild → dist/index.js
3. CDK deploy ApiStack  → sube el nuevo bundle a Lambda
4. Verificar
```

---

## Paso 1 — Correr tests

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/backend

npm run test

# Esperado:
# ✓ customer resolvers > getCustomer > returns null when customer does not exist
# ✓ customer resolvers > getCustomer > returns customer when it exists
# ✓ customer resolvers > createCustomer > creates customer and returns domain object
# ✓ customer resolvers > deleteCustomer > returns the deleted id
# Test Files  1 passed (1)
# Tests       4 passed (4)
```

Si algún test falla, **no continuar** hasta resolver el error.

---

## Paso 2 — TypeScript check

```bash
npm run typecheck

# Esperado: sin output (sin errores)
# Si hay errores: aparecen listados con archivo y línea
```

---

## Paso 3 — Lint

```bash
npm run lint

# Esperado: sin errores críticos
# Los warnings de `no-console` son aceptables en handlers
```

---

## Paso 4 — Compilar el bundle

```bash
npm run build

# Output esperado:
# [info] build started
# [info] dist/index.js   150kb
# [info] build finished

# Verificar el bundle
ls -lh dist/index.js
stat dist/index.js | grep -E "Size|Modify"
```

El bundle incluye:
- Todo el código de `src/` transpilado y minificado
- `ulid` (única dependencia runtime no-AWS)
- Excluye `@aws-sdk/*` (disponibles en el runtime Lambda)

---

## Paso 5 — Deploy del ApiStack

Solo se re-despliega el stack de API (el que contiene la Lambda):

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/infrastructure

npx cdk deploy mytascensores-backoffice-api-dev \
  --profile mytascensores \
  --context stage=dev \
  --require-approval never

# Output esperado:
# mytascensores-backoffice-api-dev: deploying...
# [0%]  start: Publishing ...
# [100%] success: Published ...
# mytascensores-backoffice-api-dev: creating CloudFormation changeset...
# ✅  mytascensores-backoffice-api-dev
```

CDK detecta que solo cambió el asset de la Lambda y actualiza únicamente esa función.

---

## Paso 6 — Verificar la Lambda actualizada

```bash
# Ver la fecha de última actualización
aws lambda get-function-configuration \
  --function-name mytascensores-backoffice-resolver-dev \
  --query "{State:State,LastModified:LastModified,CodeSize:CodeSize}" \
  --output table \
  --profile mytascensores

# Verificar que el estado es Active
# LastModified debe ser la fecha/hora actual
```

---

## Paso 7 — Smoke test

Invocar la Lambda directamente con un payload de prueba:

```bash
aws lambda invoke \
  --function-name mytascensores-backoffice-resolver-dev \
  --payload '{"typeName":"Query","fieldName":"listCustomers","arguments":{"filter":{"limit":5}},"identity":{"sub":"test-user","username":"test@test.com","claims":{}},"source":null,"request":{"headers":{},"domainName":null},"info":{"fieldName":"listCustomers","parentTypeName":"Query","variables":{},"selectionSetList":[],"selectionSetGraphQL":""}}' \
  --cli-binary-format raw-in-base64-out \
  --profile mytascensores \
  /tmp/lambda-response.json && cat /tmp/lambda-response.json
```

Respuesta esperada:
```json
{"items":[],"nextToken":null}
```

Si la Lambda devuelve un error, ver los logs:

```bash
aws logs tail \
  /aws/lambda/mytascensores-backoffice-resolver-dev \
  --since 5m \
  --profile mytascensores
```

---

## Método alternativo — Update directo de código (más rápido)

Si solo cambió el código y la configuración de la Lambda no cambió,
es posible hacer un update directo sin CDK:

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/backend

# Crear zip del bundle
zip -j dist/lambda.zip dist/index.js

# Subir directamente
aws lambda update-function-code \
  --function-name mytascensores-backoffice-resolver-dev \
  --zip-file fileb://dist/lambda.zip \
  --profile mytascensores

# Esperar a que esté activa
aws lambda wait function-updated \
  --function-name mytascensores-backoffice-resolver-dev \
  --profile mytascensores

echo "Lambda actualizada correctamente"
```

**Nota:** Usar CDK deploy (Paso 5) es preferible porque mantiene el estado
de infraestructura sincronizado. El update directo solo para hotfixes urgentes.

---

## Continuar con

- [RB-07 — Verificación post-deploy](./RB-07-verificacion.md)
