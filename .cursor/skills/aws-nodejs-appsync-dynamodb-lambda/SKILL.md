---
name: aws-nodejs-appsync-dynamodb-lambda
description: Diseña, implementa y revisa APIs AppSync/GraphQL en Node.js (Lambda) con DynamoDB, aplicando mejores prácticas de arquitectura AWS: modelado orientado a patrones de acceso (single-table), seguridad (IAM/Cognito), idempotencia, consistencia, manejo de errores, observabilidad (logs/metrics/traces), performance, límites y costos. Usar cuando el usuario pida diseñar/implementar/revisar resolvers, schema GraphQL, funciones Lambda, acceso a DynamoDB o arquitectura serverless en AWS.
---

# AWS Node.js AppSync + DynamoDB + Lambda (Best Practices)

## Quick start (qué hacer siempre)
1. **Contrato primero**: define operación GraphQL, auth, paginación, errores y shape de respuesta.
2. **Patrones de acceso primero**: lista queries reales; diseña DynamoDB (PK/SK/GSIs) desde ahí.
3. **Seguridad por defecto**: mínimo privilegio + deriva `tenantId/userId` desde claims, nunca desde input.
4. **Writes seguros**: `ConditionExpression`/`TransactWriteItems` + idempotencia cuando aplique.
5. **Observabilidad**: logs JSON + correlation id + métricas (errores/latencia/throttles).
6. **Tests**: unit de casos de uso y repos; integra lo crítico (conditional failures, paginación, auth).

## Principios de arquitectura
- **Bounded contexts**: módulos por dominio; handlers finos; casos de uso puros; repos encapsulados.
- **Diseño para fallos**: timeouts, throttling, retries, duplicados; implementa idempotencia y condiciones.
- **Optimiza por lectura con intención**: denormaliza solo si reduce N+1 y hay estrategia de actualización.
- **Compatibilidad**: cambios en schema deben ser backwards-compatible; versiona inputs y evita breaking changes.

## Checklist por capa
### Schema GraphQL (AppSync)
- [ ] Operaciones con inputs explícitos (`CreateXInput`, `UpdateXInput`, `ListXInput`)
- [ ] Paginación estable (`limit` + `nextToken/cursor`) y orden bien definido
- [ ] Evita N+1 (batch/denormalización/queries específicas)
- [ ] Estrategia de errores consistente (GraphQL errors con `extensions.code` o `union`)
- [ ] Campos auditables (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `version` si aplica)

### Lambda (Node.js 20)
- [ ] Handler fino (parseo + correlation id + routing) → caso de uso → repo DynamoDB
- [ ] Validación + normalización de inputs antes de DynamoDB
- [ ] Autorización explícita (claims → permisos → dominio)
- [ ] Idempotencia en mutations sensibles (create/payment/etc.)
- [ ] Concurrencia controlada (`ConditionExpression` / `TransactWriteItems` / `version`)
- [ ] Clientes AWS reutilizados fuera del handler (sin estado mutable)
- [ ] Logs estructurados sin secretos/PII innecesaria

### DynamoDB
- [ ] Modelo responde a queries reales sin `Scan` en paths críticos
- [ ] `ConditionExpression` en creates/updates importantes
- [ ] GSIs justificadas por patrón de acceso; proyección mínima
- [ ] Límite 400KB item, 1MB por página de `Query`; paginación siempre
- [ ] Hot partitions mitigadas (PK distribuida; cuidado con timestamps “monótonos”)

### Seguridad y operación AWS
- [ ] IAM mínimo privilegio (acciones + recursos específicos; índices incluidos si aplica)
- [ ] No confiar en inputs para identidad/tenant
- [ ] Alarmas: timeouts, errores, latencia p95, throttling DynamoDB, DLQ (si aplica)

## Flujo recomendado cuando te pidan “implementar X”
1. **Define contrato**: query/mutation + auth + shape + errores.
2. **Lista patrones de acceso**: 3–10 bullets con “necesito listar/buscar por…”.
3. **Diseña/ajusta DynamoDB**: PK/SK + GSIs + ejemplos de items.
4. **Implementa**: caso de uso + repo + handler/resolver.
5. **Valida**: tests + observabilidad + límites + costos.

## Formato de entrega (salida esperada del agente)
Incluye siempre:
- **Contrato**: operación GraphQL + auth + paginación + errores.
- **DynamoDB**: keys/GSIs + ejemplo de item(s) + queries (con `KeyConditionExpression`).
- **Lambda**: pasos, errores, idempotencia, concurrencia.
- **Verificación**: checklist de seguridad, performance, observabilidad, tests.

## Referencias (detalle)
- DynamoDB: ver [reference-dynamodb.md](reference-dynamodb.md)
- Lambda/Node.js: ver [reference-lambda.md](reference-lambda.md)
- AppSync/GraphQL: ver [reference-appsync.md](reference-appsync.md)
