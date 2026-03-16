# 03 — Autenticación (AWS Cognito)

## Visión general

La autenticación usa AWS Cognito User Pool con las siguientes restricciones de diseño:
- **Self-signup deshabilitado** — solo administradores pueden crear usuarios
- **Grupos de autorización** en Cognito vinculados al rol del usuario
- **JWT tokens** validados directamente por AppSync sin código adicional

## Flujo de autenticación

```
Usuario (Browser)
  │
  ├─ 1. Introduce email + contraseña en Amplify UI Authenticator
  │
  ▼
aws-amplify (frontend)
  │
  ├─ 2. Llama Cognito SRP (Secure Remote Password) auth flow
  │
  ▼
Cognito User Pool
  │
  ├─ 3. Valida credenciales
  ├─ 4. Retorna: AccessToken + IdToken + RefreshToken
  │
  ▼
aws-amplify (frontend)
  │
  ├─ 5. Almacena tokens (localStorage / sessionStorage)
  │
  ▼
AppSync (cada request)
  │
  ├─ 6. Header: Authorization: Bearer {IdToken}
  ├─ 7. AppSync valida JWT contra el User Pool
  ├─ 8. Inyecta identity en el evento Lambda:
  │      event.identity.sub      ← Cognito user ID
  │      event.identity.username ← email
  │      event.identity.claims   ← todos los atributos
  └─ 9. Invoca Lambda resolver
```

## Flujo de creación de usuario (admin)

```
Admin (Browser)
  │
  ├─ 1. Mutation: createUser({ email, firstName, lastName, role, temporaryPassword })
  │
  ▼
Lambda / user/handler.ts
  │
  ├─ 2. CognitoAdmin: AdminCreateUser
  │      UserAttributes: email, given_name, family_name, custom:role
  │      MessageAction: SUPPRESS (sin email automático)
  │
  ├─ 3. CognitoAdmin: AdminAddUserToGroup → grupo según rol
  │
  ├─ 4. DynamoDB: putItem (User record con cognitoId real)
  │
  └─ 5. Retorna User → estado: PENDING_VERIFICATION
```

## Grupos de Cognito y roles

```
Grupo         Precedencia   Acceso
──────────────────────────────────────────────────────────────────
ADMIN         1             Acceso total: CRUD en todas las entidades
TECHNICIAN    2             Lectura clientes, gestión webforms asignados
SALES         3             Lectura clientes, creación webforms
VIEWER        4             Solo lectura
```

Los grupos de Cognito se mapean 1:1 con el enum `UserRole` del schema GraphQL.
La autorización a nivel de campo/operación se implementa en los resolvers Lambda
leyendo `event.identity.claims["cognito:groups"]`.

## Tokens y expiración

```
AccessToken   → 1 hora    (para llamadas API)
IdToken       → 1 hora    (contiene atributos del usuario)
RefreshToken  → 30 días   (renueva los anteriores automáticamente)
```

Amplify maneja automáticamente la renovación de tokens con el RefreshToken.

## Atributos de usuario en Cognito

```
Estándar:
  email         required, mutable
  given_name    required, mutable
  family_name   required, mutable

Personalizados:
  custom:role   mutable   ← sincronizado cuando cambia el rol en DynamoDB
```

## Configuración frontend (aws-amplify v6)

```typescript
// frontend/src/main.tsx
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId:       process.env.VITE_USER_POOL_ID,
      userPoolClientId: process.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
  API: {
    GraphQL: {
      endpoint:        process.env.VITE_GRAPHQL_ENDPOINT,
      region:          "us-east-1",
      defaultAuthMode: "userPool",  // JWT automático en cada request
    },
  },
});
```

## Configuración del componente de login

```typescript
// Amplify UI Authenticator — login sin registro
<Authenticator hideSignUp>
  <App />
</Authenticator>
```

`hideSignUp` elimina el formulario de registro del UI, coherente con la
política de que solo administradores crean usuarios.

## Consideraciones de seguridad

```
✓ Self-signup deshabilitado
✓ Contraseñas: 8+ chars, mayúsculas, dígitos, símbolos
✓ Recuperación: solo por email
✓ Tokens de acceso temporales: 1 hora
✓ preventUserExistenceErrors: true (no revela si el email existe)
✓ JWT validado por AppSync sin código custom
✓ Admin API protegida por IAM (no expuesta directamente al cliente)
```

## Acceso a la identidad en los resolvers

```typescript
// En cualquier handler
export async function createCustomer(
  event: AppSyncEvent<{ input: CreateCustomerInput }>
): Promise<Customer> {
  const userId = event.identity.sub;         // Cognito user ID
  const email  = event.identity.username;    // email del usuario
  const groups = event.identity.claims["cognito:groups"]; // roles
  // ...
}
```
