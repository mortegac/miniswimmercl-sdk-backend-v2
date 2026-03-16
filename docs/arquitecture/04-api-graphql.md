# 04 — API GraphQL (AWS AppSync)

## Visión general

AWS AppSync actúa como la capa de API GraphQL gestionada.
Elimina la necesidad de gestionar servidores, escala automáticamente
y provee subscriptions en tiempo real nativas.

## Archivo de schema

```
schema/schema.graphql   ← fuente de verdad del contrato API
```

## Entidades del schema

```
Customer    → empresa con ascensores, principal entidad de negocio
User        → usuario del backoffice (no cliente final)
Webform     → formulario de contacto / solicitud recibida
```

### Customer

```graphql
type Customer {
  id:                ID!
  rut:               String!         # RUT chileno
  companyName:       String!
  tradeName:         String
  email:             AWSEmail!
  phone:             AWSPhone
  address:           Address
  status:            CustomerStatus! # ACTIVE | INACTIVE | SUSPENDED | PROSPECT
  contacts:          [CustomerContact!]
  elevatorCount:     Int
  contractStartDate: AWSDateTime
  contractEndDate:   AWSDateTime
  notes:             String
  createdAt:         AWSDateTime!
  updatedAt:         AWSDateTime!
  createdBy:         ID!
}
```

### User

```graphql
type User {
  id:                ID!
  cognitoId:         String!
  email:             AWSEmail!
  firstName:         String!
  lastName:          String!
  role:              UserRole!    # ADMIN | TECHNICIAN | SALES | VIEWER
  status:            UserStatus! # ACTIVE | INACTIVE | PENDING_VERIFICATION
  phone:             AWSPhone
  avatarUrl:         String
  assignedCustomers: [ID!]
  lastLoginAt:       AWSDateTime
  createdAt:         AWSDateTime!
  updatedAt:         AWSDateTime!
}
```

### Webform

```graphql
type Webform {
  id:               ID!
  type:             WebformType!   # MAINTENANCE_REQUEST | QUOTE_REQUEST | ...
  status:           WebformStatus! # PENDING | IN_REVIEW | RESOLVED | REJECTED
  customerId:       ID
  submitterName:    String!
  submitterEmail:   AWSEmail!
  subject:          String!
  message:          String!
  metadata:         AWSJSON
  assignedTo:       ID
  resolvedAt:       AWSDateTime
  resolutionNotes:  String
  createdAt:        AWSDateTime!
  updatedAt:        AWSDateTime!
}
```

## Operaciones disponibles

### Queries (15)

```graphql
# Customers
getCustomer(id: ID!): Customer
listCustomers(filter: ListFilter): CustomerConnection!
searchCustomers(query: String!, filter: ListFilter): CustomerConnection!

# Users
getUser(id: ID!): User
getCurrentUser: User
listUsers(filter: ListFilter): UserConnection!

# Webforms
getWebform(id: ID!): Webform
listWebforms(filter: ListFilter): WebformConnection!
listWebformsByCustomer(customerId: ID!, filter: ListFilter): WebformConnection!
```

### Mutations (9)

```graphql
# Customers
createCustomer(input: CreateCustomerInput!): Customer!
updateCustomer(input: UpdateCustomerInput!): Customer!
deleteCustomer(id: ID!): ID!

# Users
createUser(input: CreateUserInput!): User!
updateUser(input: UpdateUserInput!): User!
deactivateUser(id: ID!): User!

# Webforms
createWebform(input: CreateWebformInput!): Webform!
updateWebform(input: UpdateWebformInput!): Webform!
assignWebform(id: ID!, userId: ID!): Webform!
```

### Subscriptions (3) — tiempo real

```graphql
onWebformCreated: Webform
  @aws_subscribe(mutations: ["createWebform"])

onWebformUpdated(id: ID): Webform
  @aws_subscribe(mutations: ["updateWebform", "assignWebform"])

onCustomerUpdated(id: ID): Customer
  @aws_subscribe(mutations: ["updateCustomer"])
```

Las subscriptions se transmiten via WebSocket gestionado por AppSync.
No requieren infraestructura adicional.

## Paginación

Todas las operaciones de lista usan cursor-based pagination:

```graphql
input ListFilter {
  limit:     Int = 20
  nextToken: String       # cursor opaco (base64 de DynamoDB LastEvaluatedKey)
  status:    String
  from:      AWSDateTime
  to:        AWSDateTime
}

type CustomerConnection {
  items:     [Customer!]!
  nextToken: String       # null si no hay más páginas
  total:     Int
}
```

## Escalares AWS

AppSync provee escalares con validación integrada:

```
AWSDateTime → ISO 8601 con timezone
AWSEmail    → formato email válido
AWSPhone    → formato E.164
AWSJSON     → JSON serializado como string
```

## Dispatcher pattern (un solo Lambda)

Todos los resolvers apuntan al mismo Lambda DataSource.
AppSync inyecta `typeName` y `fieldName` en el evento:

```
AppSync event
  ├── typeName:  "Query" | "Mutation"
  ├── fieldName: "listCustomers"
  ├── arguments: { filter: { limit: 20 } }
  └── identity:  { sub: "...", username: "..." }

Lambda (index.ts)
  └── resolverMap["Query.listCustomers"](event)
       └── customer/handler.ts → listCustomers()
```

**Ventajas del dispatcher:**
- Un solo bundle, menor cold start
- Deploy único para todos los resolvers
- Fácil de probar localmente

**Cuándo migrar a Lambdas individuales:**
- Si algún resolver necesita configuración distinta (más memoria, timeout diferente)
- Si el bundle supera ~50 MB

## Autorización

```
defaultAuth: Cognito UserPool  → JWT token requerido en header Authorization
additionalAuth: IAM            → para integraciones server-to-server futuras
```

AppSync valida el JWT antes de invocar el Lambda.
La autorización a nivel de campo se implementa en los handlers
accediendo a `event.identity.claims["cognito:groups"]`.

## Logging y observabilidad

```
fieldLogLevel: ALL              → loguea todas las operaciones
CloudWatch log group: /aws/appsync/apis/{apiId}
X-Ray tracing: habilitado       → trazas end-to-end
Log retention: 1 mes
```
