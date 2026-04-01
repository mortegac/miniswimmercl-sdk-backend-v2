---
name: aws-nodejs-appsync-dynamodb-lambda-reference-lambda
description: Referencia práctica para Lambda Node.js 20 en AWS: estructura, idempotencia, manejo de errores, seguridad, observabilidad, performance, timeouts/retries y patrones para resolvers AppSync.
---

# AWS Lambda (Node.js 20) – referencia práctica

## Estructura recomendada (para resolvers AppSync)
Separación por responsabilidad:
- **handler**: adapta evento AppSync → input del caso de uso, setea correlation id, captura errores.
- **use cases**: lógica de negocio (invariantes), no conoce AppSync ni DynamoDB directo.
- **repos**: DynamoDB (DocumentClient), queries y condiciones encapsuladas.
- **mappers**: DTO ↔ dominio ↔ GraphQL.

Beneficios: test fácil, cambios de infraestructura aislados, menos “spaghetti” de resolver.

## Manejo de errores (consistente)
### Clasificación mínima
Define (conceptualmente) clases/códigos:
- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT` (incluye conditional check failure)
- `THROTTLED`
- `INTERNAL`

### En AppSync/GraphQL
Estrategia común:
- Lanzar GraphQL errors con `extensions.code` y opcional `extensions.details` (sin filtrar PII).

### Reglas
- Nunca exponer stack traces al cliente.
- Loguear stack trace solo en server-side con correlation id.
- Diferenciar errores esperables (validation/conditional) vs inesperados (bugs).

## Idempotencia (mutations)
### Cuándo usarla
- `create*` que puede repetirse por retries/cliente.
- Operaciones con side effects (pagos, asignaciones, emails, etc.).

### Patrón recomendado con DynamoDB
1. Requiere `idempotencyKey` (o `clientRequestId`) desde el cliente.
2. Guarda un “token” por \(tenantId + idempotencyKey\) con TTL.
3. En create:
   - `Put` token con `ConditionExpression attribute_not_exists(...)`
   - Si ya existe, retorna el resultado previo (si lo guardas) o responde `CONFLICT`/“duplicate”.
4. Para “exactly-once” efectivo: guarda referencia al recurso creado en el token.

## Concurrencia y consistencia
### Pattern: optimistic concurrency
- Campo `version` (number) por agregado.
- Update con condición `version = :expected`.
- Incrementa `version` en el update.

### Pattern: transacciones
Cuando hay invariantes multi-item:
- `TransactWriteItems` (ojo con límites y costo).
- Si falla, parsea cancellation reasons para mapear a `CONFLICT` vs `INTERNAL`.

## Performance en Lambda
- **Clientes AWS reutilizados** fuera del handler (evita recrear por request).
- **Evitar trabajo CPU-bound**; si es necesario, subir memoria para más CPU.
- **Batching**:
  - `BatchGet` y `BatchWrite` cuando aplica.
  - Manejar “unprocessed keys” con backoff.
- **Payloads**: no retornes objetos enormes en GraphQL; pagina; selecciona campos.

## Timeouts, retries y límites
- Ajusta `timeout` de Lambda según p95 + margen.
- Considera que AppSync también tiene límites de tiempo/payload.
- DynamoDB throttling puede causar retries; maneja backoff y errores `ProvisionedThroughputExceededException`.

## Observabilidad
### Logs
- JSON estructurado (nivel, mensaje, operationName/fieldName, requestId, tenantId).
- No loguear tokens, credenciales, PII innecesaria.

### Métricas (CloudWatch)
Emitir (o derivar) métricas por:
- `operation`/`fieldName`
- error count por `code`
- latency p50/p95
- conditional check failures
- DynamoDB throttles/retries

### Tracing
- X-Ray si está habilitado; propaga correlation/trace id.

## Seguridad
- Nunca confiar en `tenantId/userId` del input; derivarlo de claims.
- Validación estricta de inputs; normaliza strings.
- Principle of least privilege IAM para `dynamodb:*` y otros servicios.

## Checklist de revisión Lambda
- [ ] Handler fino → use case → repo
- [ ] Auth/tenant derivado de claims
- [ ] Validación antes de DynamoDB
- [ ] Idempotencia donde corresponde
- [ ] Condiciones/transacciones para invariantes
- [ ] Logs estructurados + correlation id + sin secretos
- [ ] Métricas/alertas consideradas
