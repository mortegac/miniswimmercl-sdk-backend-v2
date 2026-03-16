# RB-08 — Rollback

**Cuándo usar:** Un deploy causó un error en producción y necesitas revertir.
**Urgencia:** Alta. Ejecutar lo antes posible al detectar el problema.

---

## Árbol de decisión

```
¿Qué falló?
│
├─ Solo el código Lambda (resolvers)
│   └─ → Opción A: Rollback de Lambda (< 2 min)
│
├─ Schema GraphQL + Lambda
│   └─ → Opción B: Rollback de ApiStack (5 min)
│
├─ Infraestructura completa (DynamoDB, Cognito)
│   └─ → Opción C: Rollback de CloudFormation (10-20 min)
│
└─ Datos corruptos en DynamoDB
    └─ → Opción D: Point-in-time Recovery (solo prod, 20+ min)
```

---

## Opción A — Rollback de Lambda (más rápido)

Lambda guarda automáticamente las últimas versiones del código.

```bash
LAMBDA_NAME="mytascensores-backoffice-resolver-prod"

# 1. Listar las últimas versiones publicadas
aws lambda list-versions-by-function \
  --function-name $LAMBDA_NAME \
  --query "Versions[*].{Version:Version,Modified:LastModified,Size:CodeSize}" \
  --output table \
  --profile mytascensores

# 2. Obtener el ARN de la versión anterior (la que funcionaba)
#    Ejemplo: arn:aws:lambda:us-east-1:123456789012:function:mytascensores-backoffice-resolver-prod:5

# 3. Descargar el código de la versión anterior
aws lambda get-function \
  --function-name "${LAMBDA_NAME}:VERSION_ANTERIOR" \
  --query "Code.Location" \
  --output text \
  --profile mytascensores
# → retorna una URL pre-firmada. Descargar con curl.

# 4. Restaurar esa versión como la activa
aws lambda update-function-code \
  --function-name $LAMBDA_NAME \
  --zip-file fileb://version-anterior.zip \
  --profile mytascensores

# 5. Esperar que esté activa
aws lambda wait function-updated \
  --function-name $LAMBDA_NAME \
  --profile mytascensores

echo "Rollback de Lambda completado"
```

### Alternativa rápida — recompilar desde git

```bash
# Ir al commit anterior que funcionaba
git log --oneline -10              # ver historial
git checkout {COMMIT_HASH} -- backend/src/

# Recompilar
cd backend && npm run build

# Re-deploy solo el ApiStack
cd ../infrastructure
npx cdk deploy mytascensores-backoffice-api-prod \
  --profile mytascensores \
  --context stage=prod \
  --require-approval never

# Volver al HEAD de la rama
git checkout HEAD -- backend/src/
```

---

## Opción B — Rollback del ApiStack con CDK

Si el problema incluye cambios en el schema o configuración de AppSync:

```bash
# 1. Revertir los cambios en git
git log --oneline -5
git revert HEAD    # o git checkout {COMMIT_ANTERIOR} -- .

# 2. Recompilar backend
cd backend && npm run build

# 3. Re-deploy del ApiStack a la versión anterior
cd ../infrastructure
npx cdk deploy mytascensores-backoffice-api-prod \
  --profile mytascensores \
  --context stage=prod \
  --require-approval never
```

---

## Opción C — Rollback de CloudFormation

Si el stack quedó en estado `UPDATE_ROLLBACK_FAILED`:

```bash
# Ver el estado actual
aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-api-prod \
  --query "Stacks[0].{Status:StackStatus,StatusReason:StackStatusReason}" \
  --output table \
  --profile mytascensores

# Si el stack está en UPDATE_ROLLBACK_FAILED, continuar el rollback
aws cloudformation continue-update-rollback \
  --stack-name mytascensores-backoffice-api-prod \
  --profile mytascensores

# Esperar
aws cloudformation wait stack-rollback-complete \
  --stack-name mytascensores-backoffice-api-prod \
  --profile mytascensores

echo "CloudFormation rollback completado"
```

---

## Opción D — Point-in-time Recovery de DynamoDB (solo prod)

Si los datos fueron corrompidos por un bug en los resolvers:

```bash
TABLE_NAME="mytascensores-backoffice-prod"

# 1. Verificar que PITR está habilitado
aws dynamodb describe-continuous-backups \
  --table-name $TABLE_NAME \
  --query "ContinuousBackupsDescription.PointInTimeRecoveryDescription" \
  --output table \
  --profile mytascensores

# ✅ PointInTimeRecoveryStatus = ENABLED
# Muestra: EarliestRestorableDateTime y LatestRestorableDateTime

# 2. Restaurar a un punto anterior (en una tabla NUEVA, no sobreescribe la actual)
RESTORE_TIMESTAMP="2026-03-13T15:00:00Z"   # momento antes del problema
TABLA_RESTAURADA="mytascensores-backoffice-prod-restored"

aws dynamodb restore-table-to-point-in-time \
  --source-table-name $TABLE_NAME \
  --target-table-name $TABLA_RESTAURADA \
  --restore-date-time $RESTORE_TIMESTAMP \
  --profile mytascensores

# 3. Monitorear la restauración (puede tardar 20-60 minutos)
aws dynamodb describe-table \
  --table-name $TABLA_RESTAURADA \
  --query "Table.{Status:TableStatus}" \
  --output text \
  --profile mytascensores
# Repetir hasta que Status = ACTIVE

# 4. Comparar datos y decidir si reemplazar la tabla activa
# ⚠️ Cambiar el TABLE_NAME en Lambda requiere un re-deploy del ApiStack

# 5. Si se confirma que la tabla restaurada es correcta:
#    a. Actualizar api-stack.ts para apuntar a la nueva tabla
#    b. Re-deploy del ApiStack
#    c. Eliminar la tabla corrupta (cuando sea seguro)
```

---

## Post-rollback

Después de cualquier rollback:

```bash
# 1. Verificar que el sistema funciona
# → Seguir RB-07 completo

# 2. Revisar los logs para entender la causa raíz
aws logs tail \
  /aws/lambda/mytascensores-backoffice-resolver-prod \
  --since 30m \
  --profile mytascensores

# 3. Documentar el incidente:
#    - Qué falló
#    - Cuándo se detectó
#    - Cómo se resolvió
#    - Tiempo de impacto
#    - Acción preventiva

# 4. Comunicar al equipo que el sistema fue restaurado
```

---

## Prevenir la necesidad de rollback

```
✓ Siempre desplegar en dev antes que prod
✓ Siempre revisar el CDK diff antes de deploy
✓ Tests antes de cada deploy (Husky en commits)
✓ Monitorear CloudWatch logs inmediatamente post-deploy
✓ Tener acceso a las credenciales AWS disponibles en todo momento
✓ Conocer este runbook de antemano
```
