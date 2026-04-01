---
name: aws-nodejs-appsync-dynamodb-lambda-reference-dynamodb
description: Referencia práctica de modelado y operaciones DynamoDB (single-table, GSIs, paginación, condiciones, transacciones, hot partitions, TTL, límites y costos) para APIs serverless.
---

# DynamoDB (NoSQL) – referencia práctica

## Diseña desde patrones de acceso (no desde ERD)
Antes de tocar PK/SK, escribe patrones concretos (ejemplos):
- “Obtener `SupportTicket` por `ticketId`”
- “Listar tickets por `tenantId` + `status` ordenados por `createdAt`”
- “Listar tickets asignados a `userId`”
- “Listar comentarios por `ticketId` ordenados por tiempo”
- “Validar idempotencia por `tenantId` + `idempotencyKey`”

## Single-table (recomendado)
### Convenciones
- **PK/SK con prefijos** para tipos y jerarquías.
  - `PK = TENANT#<tenantId>`
  - `SK = TICKET#<ticketId>`
  - `SK = TICKET#<ticketId>#COMMENT#<commentId>`
- **Atributo `entityType`** (o similar) para filtros/depuración.
- **Orden estable**: usa SK con componente temporal/lexicográfico cuando necesites orden.

### Ejemplo de items (misma partición por tenant)
- Ticket:
  - `PK: TENANT#t1`
  - `SK: TICKET#tk_123`
  - `status: OPEN`
  - `createdAt: 2026-03-16T12:00:00.000Z`
  - `assignedUserId: u_77`
- Comentario:
  - `PK: TENANT#t1`
  - `SK: TICKET#tk_123#COMMENT#2026-03-16T12:05:00.000Z#c_1`
  - `ticketId: tk_123`
  - `message: ...`

## Índices (GSI) por patrón de consulta
### Reglas
- **1 GSI = 1 patrón crítico**. Evita crear GSIs “por si acaso”.
- **Proyección mínima** para reducir costo/latencia (incluye solo atributos requeridos).
- **Define cardinalidad**: si el patrón es “por usuario asignado”, la partición del GSI suele ser `USER#<id>`.

### Ejemplos de GSIs
1) Listar por estado:
- `GSI1PK: TENANT#<tenantId>#STATUS#<status>`
- `GSI1SK: CREATEDAT#<iso>#TICKET#<ticketId>`

2) Listar por asignado:
- `GSI2PK: TENANT#<tenantId>#ASSIGNEE#<userId>`
- `GSI2SK: CREATEDAT#<iso>#TICKET#<ticketId>`

## Operaciones seguras (conditions + transacciones)
### Create sin duplicados
Usa `PutItem`/`UpdateItem` con:
- `ConditionExpression: attribute_not_exists(PK)` (o `attribute_not_exists(SK)` según estructura)

### Update con existencia
- `ConditionExpression: attribute_exists(PK)` + `attribute_exists(SK)`

### Concurrencia optimista (versionado)
Incluye `version` (number):
- Lee `version`
- Update con condición `version = :expected`
- Incrementa `version` en el update

### Invariantes multi-item
Si necesitas “todo o nada” entre ítems:
- `TransactWriteItems` (ojo con límites y costo)
- Maneja `TransactionCanceledException` y detalla causas (conditional failures)

## Paginación correcta (Query)
### Reglas
- `Query` devuelve hasta **1MB por página**: siempre usar `LastEvaluatedKey` (o `nextToken` en AppSync).
- Evita ordenar “en app” si puedes ordenar por SK o GSI SK.
- Si necesitas “página 3”, itera tokens; DynamoDB no soporta offset real.

## Evita hot partitions
### Señales de hot partition
- Muchos writes/reads al mismo PK (p.ej. `PK=TENANT#global`).
- SK creciente por timestamp dentro de la misma partición con muchísima carga.

### Mitigaciones
- Particionar por tenant (casi siempre).
- Si un tenant es enorme: “bucket/shard” por hash o por ventana temporal.
- Evitar contadores globales; usar agregaciones por ventanas o streams.

## TTL (Time To Live)
- Útil para idempotencia, dedupe tokens, caches, sesiones.
- No asumir borrado inmediato; TTL es eventual.
- No usar TTL como mecanismo de “seguridad” (solo housekeeping).

## Límites y decisiones frecuentes
- **Item size**: 400KB → blobs a S3.
- **BatchGet/BatchWrite**: útiles, pero requieren manejo de unprocessed keys por throttling.
- **Consistencia**:
  - `GetItem` puede ser strongly consistent (en tabla, no en GSI).
  - Consultas por GSI son eventualmente consistentes.

## Checklist de revisión DynamoDB
- [ ] No hay `Scan` en paths principales.
- [ ] Cada GSI tiene patrón de acceso documentado.
- [ ] Writes importantes usan `ConditionExpression`/transacciones.
- [ ] Paginación implementada y testeada.
- [ ] Modelo contempla límites (1MB/400KB) y hot partitions.
