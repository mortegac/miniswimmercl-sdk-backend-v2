# 05 — Base de Datos (DynamoDB Single-Table)

## Por qué Single-Table Design

DynamoDB no es una base de datos relacional. El patrón single-table
aprovecha su modelo de acceso directo por clave y elimina los joins costosos.

**Resultado:** cada operación es O(1) — una sola llamada a DynamoDB.

## Tabla principal

```
Nombre:    mytascensores-backoffice-{stage}
PK:        Partition Key (String)
SK:        Sort Key (String)
GSI1PK:    Global Secondary Index 1 Partition Key
GSI1SK:    Global Secondary Index 1 Sort Key
GSI2PK:    Global Secondary Index 2 Partition Key
GSI2SK:    Global Secondary Index 2 Sort Key
```

## Mapa de claves por entidad

```
┌──────────────┬──────────────────────────┬─────────────────────────────────────┐
│ Entidad      │ PK                       │ SK                                  │
├──────────────┼──────────────────────────┼─────────────────────────────────────┤
│ Customer     │ CUSTOMER#{id}            │ METADATA                            │
│ User         │ USER#{id}                │ METADATA                            │
│ Webform      │ WEBFORM#{id}             │ METADATA                            │
│ Webform      │ CUSTOMER#{customerId}    │ WEBFORM#{createdAt}#{id}            │
│   (ref)      │                          │   (para query por customer)         │
└──────────────┴──────────────────────────┴─────────────────────────────────────┘
```

## Access Patterns y cómo se resuelven

### 1. Obtener entidad por ID

```
GET /Customer/{id}

PK = CUSTOMER#{id}
SK = METADATA

→ GetItem  O(1)
```

### 2. Listar Customers por status

```
GET /Customers?status=ACTIVE

Tabla: GSI1
GSI1PK = CUSTOMER#ACTIVE
GSI1SK desc (más recientes primero)

→ Query GSI1  O(n) paginado
```

```
GSI1PK patterns:
  CUSTOMER#ACTIVE
  CUSTOMER#INACTIVE
  CUSTOMER#SUSPENDED
  CUSTOMER#PROSPECT
```

### 3. Listar Users por rol

```
GET /Users?role=ADMIN

Tabla: GSI1
GSI1PK = USER#ADMIN

→ Query GSI1
```

```
GSI1PK patterns:
  USER#ADMIN
  USER#TECHNICIAN
  USER#SALES
  USER#VIEWER
```

### 4. Listar Webforms por tipo + status

```
GET /Webforms?type=EMERGENCY&status=PENDING

Tabla: GSI1
GSI1PK = WEBFORM#EMERGENCY#PENDING

→ Query GSI1
```

```
GSI1PK patterns:
  WEBFORM#MAINTENANCE_REQUEST#PENDING
  WEBFORM#MAINTENANCE_REQUEST#IN_REVIEW
  WEBFORM#MAINTENANCE_REQUEST#RESOLVED
  WEBFORM#MAINTENANCE_REQUEST#REJECTED
  WEBFORM#QUOTE_REQUEST#PENDING
  WEBFORM#EMERGENCY#PENDING
  ...
```

### 5. Listar Webforms de un Customer

```
GET /Customers/{id}/Webforms

PK = CUSTOMER#{customerId}
SK begins_with "WEBFORM#"

→ Query tabla principal con begins_with
```

Cada webform crea 2 registros: su registro principal (WEBFORM#{id}) y
un registro de referencia en la partición del customer.

### 6. Obtener User actual por Cognito ID

```
GET /me (getCurrentUser)

Tabla: GSI2
GSI2PK = COGNITO#{cognitoSub}

→ Query GSI2  (Limit: 1)
```

### 7. Listar Webforms asignados a un User

```
GET /Webforms?assignedTo={userId}

Tabla: GSI2
GSI2PK = USER#{userId}

→ Query GSI2
```

## Estructura de un registro completo

### Customer Record

```json
{
  "PK":          "CUSTOMER#01J9XXXXX",
  "SK":          "METADATA",
  "GSI1PK":      "CUSTOMER#ACTIVE",
  "GSI1SK":      "2026-01-15T10:30:00.000Z",
  "entityType":  "CUSTOMER",

  "id":          "01J9XXXXX",
  "rut":         "76543210-1",
  "companyName": "Torres del Pacifico SA",
  "email":       "contacto@torres.cl",
  "status":      "ACTIVE",
  "elevatorCount": 3,
  "address": {
    "street": "Av. Apoquindo",
    "number": "4501",
    "city":   "Las Condes",
    "region": "Metropolitana",
    "country": "Chile"
  },
  "createdAt":   "2026-01-15T10:30:00.000Z",
  "updatedAt":   "2026-01-15T10:30:00.000Z",
  "createdBy":   "01J8USER00"
}
```

### Webform Record

```json
{
  "PK":          "WEBFORM#01J9YYYYY",
  "SK":          "METADATA",
  "GSI1PK":      "WEBFORM#MAINTENANCE_REQUEST#PENDING",
  "GSI1SK":      "2026-03-01T09:00:00.000Z",
  "GSI2PK":      "USER#01J8USER00",
  "GSI2SK":      "2026-03-01T09:00:00.000Z",
  "entityType":  "WEBFORM",

  "id":             "01J9YYYYY",
  "type":           "MAINTENANCE_REQUEST",
  "status":         "IN_REVIEW",
  "customerId":     "01J9XXXXX",
  "submitterName":  "Carlos López",
  "submitterEmail": "carlos@torres.cl",
  "subject":        "Ascensor piso 8 con ruido",
  "message":        "El ascensor del piso 8 hace un ruido extraño...",
  "assignedTo":     "01J8USER00",
  "createdAt":      "2026-03-01T09:00:00.000Z",
  "updatedAt":      "2026-03-01T11:00:00.000Z"
}
```

## Cómo se actualiza GSI1PK al cambiar status

Cuando un Customer cambia de status, el `buildUpdatePayload` en el
`RepositoryFactory` actualiza también el atributo `GSI1PK`:

```
UPDATE Customer#01J9XXXXX METADATA
  SET status = "INACTIVE"
  SET GSI1PK = "CUSTOMER#INACTIVE"   ← mueve al customer al índice correcto
  SET updatedAt = "..."
```

El registro desaparece de `CUSTOMER#ACTIVE` y aparece en `CUSTOMER#INACTIVE`
automáticamente gracias a que DynamoDB mantiene los GSI sincronizados.

## Índices secundarios globales

### GSI1 — type + status

```
IndexName:  GSI1
PK:         GSI1PK (String)
SK:         GSI1SK (String = createdAt para orden cronológico)
Projection: ALL
Uso:        listCustomers, listUsers, listWebforms
```

### GSI2 — usuario asignado / Cognito

```
IndexName:  GSI2
PK:         GSI2PK (String)
SK:         GSI2SK (String = createdAt)
Projection: ALL
Uso:        getCurrentUser, listWebformsByUser
```

## Paginación con cursor

DynamoDB devuelve un `LastEvaluatedKey` cuando hay más páginas.
Lo serializamos como base64 para exponerlo como `nextToken` opaco:

```typescript
// Serializar
nextToken = Buffer.from(JSON.stringify(LastEvaluatedKey)).toString("base64")

// Deserializar
ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, "base64").toString("utf-8"))
```

## TTL (Time to Live)

El atributo `ttl` (Unix timestamp) está configurado en la tabla.
Permite expirar automáticamente registros temporales sin operaciones de limpieza.
Actualmente no se usa, pero está disponible sin cambios de schema.

## DynamoDB Stream

Configurado con `NEW_AND_OLD_IMAGES` para uso futuro:
- Auditoria de cambios
- Triggers de notificación (SNS/SES)
- Sincronización con servicios externos
- Invalidación de caché

## Capacity mode

`PAY_PER_REQUEST` (on-demand) — sin capacity planning ni auto-scaling.
Apropiado para cargas variables e impredecibles de un backoffice interno.
Migrar a `PROVISIONED` si la carga se vuelve predecible y el costo es relevante.
