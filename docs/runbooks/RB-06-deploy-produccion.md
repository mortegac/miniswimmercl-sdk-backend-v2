# RB-06 — Deploy a Producción

**Cuándo usar:** Release oficial de una versión al ambiente de producción.
**Prerrequisito:** El cambio fue desplegado y verificado en `dev` primero.
**Tiempo estimado:** 15–30 minutos.

---

## Diferencias entre dev y prod

| Aspecto | dev | prod |
|---------|-----|------|
| `removalPolicy` DynamoDB | DESTROY | **RETAIN** |
| `removalPolicy` Cognito | DESTROY | **RETAIN** |
| `pointInTimeRecovery` | false | **true** |
| `LOG_LEVEL` Lambda | 4 (DEBUG) | **2 (WARN)** |
| Recursos al destruir stack | Se eliminan | **Se conservan** |

---

## Checklist pre-deploy (obligatorio)

Completar **todos** los items antes de continuar:

```
[ ] 1. Tests pasan en local:   cd backend && npm run test
[ ] 2. Sin errores TypeScript:  npm run typecheck
[ ] 3. Sin errores lint:        npm run lint
[ ] 4. Cambio desplegado y verificado en dev (stage=dev)
[ ] 5. Revisado el CDK diff para prod:
        cd infrastructure && npx cdk diff --all -c stage=prod
[ ] 6. No hay destrucción de recursos en el diff ([-] sin tablas ni User Pools)
[ ] 7. Comunicar al equipo: "Deploy a prod en X minutos"
[ ] 8. Horario: preferir horarios de baja actividad
```

---

## Paso 1 — Compilar el backend para prod

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/backend

# Tests completos
npm run test

# TypeScript
npm run typecheck

# Bundle de producción (con minificación)
NODE_ENV=production npm run build

# Verificar tamaño del bundle
ls -lh dist/index.js
```

---

## Paso 2 — Ver diff de prod

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/infrastructure

npx cdk diff --all \
  --profile mytascensores \
  --context stage=prod
```

Verificar cuidadosamente:
- No debe haber `[-]` en tablas DynamoDB
- No debe haber `[-]` en Cognito User Pool
- Revisar cualquier cambio en políticas IAM

---

## Paso 3 — Deploy a producción

```bash
# Primer deploy a prod (si el stage prod no existe aún)
npx cdk deploy --all \
  --profile mytascensores \
  --context stage=prod \
  --require-approval never

# Output esperado:
# ✅  mytascensores-backoffice-auth-prod
# ✅  mytascensores-backoffice-database-prod
# ✅  mytascensores-backoffice-api-prod
```

### Deploy de solo el ApiStack (updates frecuentes)

```bash
# Si solo cambió el código Lambda o el schema
npx cdk deploy mytascensores-backoffice-api-prod \
  --profile mytascensores \
  --context stage=prod \
  --require-approval never
```

---

## Paso 4 — Recoger outputs de prod

```bash
# Auth outputs
USER_POOL_ID_PROD=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-auth-prod \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text \
  --profile mytascensores)

USER_POOL_CLIENT_ID_PROD=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-auth-prod \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" \
  --output text \
  --profile mytascensores)

# API output
GRAPHQL_ENDPOINT_PROD=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-api-prod \
  --query "Stacks[0].Outputs[?OutputKey=='GraphqlApiUrl'].OutputValue" \
  --output text \
  --profile mytascensores)

echo "=== PROD Outputs ==="
echo "USER_POOL_ID:        $USER_POOL_ID_PROD"
echo "USER_POOL_CLIENT_ID: $USER_POOL_CLIENT_ID_PROD"
echo "GRAPHQL_ENDPOINT:    $GRAPHQL_ENDPOINT_PROD"
```

---

## Paso 5 — Configurar frontend para prod

```bash
# Crear .env.production
cat > /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/frontend/.env.production << EOF
VITE_AWS_REGION=us-east-1
VITE_USER_POOL_ID=$USER_POOL_ID_PROD
VITE_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID_PROD
VITE_GRAPHQL_ENDPOINT=$GRAPHQL_ENDPOINT_PROD
EOF

cat frontend/.env.production
```

---

## Paso 6 — Build del frontend para prod

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/frontend

npm install

# Build de producción (usa .env.production automáticamente)
npm run build

# Verificar el build
ls -lh dist/
# Esperado: index.html + assets/ con archivos .js y .css
```

El directorio `frontend/dist/` contiene el sitio estático listo para deploy
en S3 + CloudFront, Amplify Hosting, o cualquier CDN.

---

## Paso 7 — Crear primer usuario admin en prod

Si es la primera vez desplegando el stage prod:

```bash
# Seguir RB-05 con los valores de prod
USER_POOL_ID=$USER_POOL_ID_PROD

# (seguir los mismos pasos del RB-05)
```

---

## Paso 8 — Verificación post-deploy prod

```bash
# Verificar Lambda activa
aws lambda get-function-configuration \
  --function-name mytascensores-backoffice-resolver-prod \
  --query "{State:State,LastModified:LastModified}" \
  --output table \
  --profile mytascensores

# Verificar AppSync
aws appsync list-graphql-apis \
  --query "graphqlApis[?name=='mytascensores-backoffice-prod'].{Name:name,Endpoint:uris.GRAPHQL}" \
  --output table \
  --profile mytascensores

# Ver logs recientes (si hubo requests)
aws logs tail \
  /aws/lambda/mytascensores-backoffice-resolver-prod \
  --since 10m \
  --profile mytascensores
```

---

## Paso 9 — Smoke test en prod

```bash
# Test básico de conectividad (requiere JWT token válido)
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN_PROD" \
  -d '{"query":"{ listCustomers(filter:{limit:1}) { items { id } } }"}' \
  "$GRAPHQL_ENDPOINT_PROD" | python3 -m json.tool
```

---

## Rollback inmediato

Si se detecta un problema grave después del deploy:
→ Ver [RB-08 — Rollback](./RB-08-rollback.md)

---

## Checklist post-deploy prod

```
[ ] Los 3 stacks muestran estado UPDATE_COMPLETE o CREATE_COMPLETE
[ ] Lambda State = Active, LastModified = ahora
[ ] Logs de Lambda sin errores en CloudWatch
[ ] Smoke test GraphQL responde correctamente
[ ] Frontend build exitoso
[ ] Usuario admin puede loguearse
[ ] Comunicar al equipo: "Deploy a prod completado"
```
