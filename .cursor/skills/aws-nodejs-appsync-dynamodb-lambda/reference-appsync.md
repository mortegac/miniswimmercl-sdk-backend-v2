---
name: aws-nodejs-appsync-dynamodb-lambda-reference-appsync
description: Referencia práctica para diseño de APIs AppSync/GraphQL: schema, paginación, auth con Cognito/IAM, manejo de errores, límites, evitar N+1, y patrones de resolvers con Lambda.
---

# AppSync / GraphQL – referencia práctica

## Diseño de schema
### Inputs y outputs
- Prefiere inputs explícitos:
  - `CreateXInput`, `UpdateXInput`, `DeleteXInput`, `ListXInput`
- Separa “servidor controla” vs “cliente provee”:
  - `createdAt/updatedAt/createdBy/updatedBy/tenantId` deberían ser server-side.

### Paginación
Reglas:
- Usa `limit` + `nextToken` (o cursor) siempre en listas.
- Orden estable: define por qué campo ordenas (SK/GSI SK) y mantén consistencia.
- Evita `offset`; no escala y no mapea bien a DynamoDB.

### Errores
Dos estrategias válidas; el skill recomienda elegir **una** y aplicarla siempre:
1) **GraphQL errors** con `extensions.code` (simple, estándar).
2) **Unions type-safe** (`Result = Success | Error`) si tu generación de tipos/cliente lo maneja bien.

Recomendación práctica:
- Para resolvers Lambda, GraphQL errors con `extensions.code` suele ser suficiente y menos verboso.

## Autorización (Cognito/IAM)
### Principios
- La autorización debe estar definida **por operación** (query/mutation/subscription).
- Deriva `tenantId/userId` desde claims (JWT) o `identity`.
- No permitas “escapes” por parámetros del cliente.

### Controles típicos
- **Owner-based**: el usuario solo accede a sus recursos.
- **Group-based**: roles/grupos (admin, staff, coach, etc.).
- **Field-level**: campos sensibles (p.ej. PII) solo para ciertos grupos.

## Evitar N+1
### Patrones
- Diseña queries que devuelvan el shape necesario sin resolver relaciones item por item.
- Denormaliza “summary fields” si evita múltiples lecturas.
- Si necesitas composición:
  - Batch en el repo (una query/batch por set)
  - Estructuras “list + details” separadas (cliente pide detalles al navegar)

## Límites operativos (para tener presentes)
- Tamaño de respuestas/payloads: mantener listas paginadas, evitar objetos gigantes.
- Latencia de resolver: optimiza cantidad de roundtrips a DynamoDB.
- Timeouts: define budgets por operación (p95).

## Patrón de resolver Lambda (por operación)
Checklist:
- [ ] Identifica `fieldName`/`operationName` y valida input
- [ ] Autorización según claims
- [ ] Ejecuta caso de uso (idempotencia / condiciones / transacciones si aplica)
- [ ] Mapea a output GraphQL
- [ ] Errores → `extensions.code` consistente

## Checklist de revisión AppSync/GraphQL
- [ ] Schema consistente (inputs, naming, paginación)
- [ ] Auth explícita y testeada (happy + unauthorized + forbidden)
- [ ] No N+1 obvio (relaciones/bucles de resolvers)
- [ ] Errores con códigos consistentes
- [ ] Respuestas paginadas y con límites claros
