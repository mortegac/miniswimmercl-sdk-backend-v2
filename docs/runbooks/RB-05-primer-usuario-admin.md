# RB-05 — Crear Primer Usuario Administrador

**Cuándo usar:** Inmediatamente después del primer deploy de un stage nuevo.
Sin un usuario admin, no se puede ingresar al backoffice.
**Prerrequisito:** [RB-02](./RB-02-primer-deploy.md) completado con éxito.

---

## Contexto

El Cognito User Pool tiene `selfSignUpEnabled: false`, por lo que los usuarios
no pueden registrarse solos. El primer admin debe crearse via AWS CLI usando
las credenciales del administrador de la cuenta.

---

## Paso 1 — Obtener el User Pool ID

```bash
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-auth-dev \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text \
  --profile mytascensores)

echo "User Pool ID: $USER_POOL_ID"
# Ejemplo: us-east-1_AbCdEfGhI
```

---

## Paso 2 — Crear el usuario en Cognito

```bash
# Reemplazar los valores con los datos reales del primer admin
ADMIN_EMAIL="admin@mytascensores.cl"
ADMIN_NOMBRE="Admin"
ADMIN_APELLIDO="Principal"
TEMP_PASSWORD="Temp@1234"   # contraseña temporal segura

aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username $ADMIN_EMAIL \
  --user-attributes \
    Name=email,Value=$ADMIN_EMAIL \
    Name=given_name,Value=$ADMIN_NOMBRE \
    Name=family_name,Value=$ADMIN_APELLIDO \
    Name=email_verified,Value=true \
    "Name=custom:role,Value=ADMIN" \
  --temporary-password "$TEMP_PASSWORD" \
  --message-action SUPPRESS \
  --profile mytascensores

# Output esperado: JSON con los detalles del usuario creado
# "UserStatus": "FORCE_CHANGE_PASSWORD"
```

---

## Paso 3 — Asignar al grupo ADMIN

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username $ADMIN_EMAIL \
  --group-name ADMIN \
  --profile mytascensores

echo "Usuario $ADMIN_EMAIL agregado al grupo ADMIN"
```

---

## Paso 4 — Cambiar la contraseña temporal a permanente

El usuario tiene `FORCE_CHANGE_PASSWORD`. Hay dos opciones:

### Opción A — Via AWS CLI (sin pasar por el frontend)

```bash
NUEVA_PASSWORD="NuevaPass@2026!"   # contraseña segura definitiva

aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username $ADMIN_EMAIL \
  --password "$NUEVA_PASSWORD" \
  --permanent \
  --profile mytascensores

echo "Contraseña establecida como permanente"
```

### Opción B — Via el frontend (flujo normal)

1. Abrir `http://localhost:5173` (o URL del frontend)
2. Ingresar con `$ADMIN_EMAIL` y `$TEMP_PASSWORD`
3. Amplify Authenticator pedirá cambiar la contraseña
4. Ingresar la nueva contraseña permanente

---

## Paso 5 — Verificar el estado del usuario

```bash
aws cognito-idp admin-get-user \
  --user-pool-id $USER_POOL_ID \
  --username $ADMIN_EMAIL \
  --profile mytascensores \
  --query "{Status:UserStatus,Email:Username,Enabled:Enabled,Groups:UserAttributes}"

# Verificar que UserStatus sea "CONFIRMED" (no "FORCE_CHANGE_PASSWORD")
```

---

## Paso 6 — Crear registro en DynamoDB

El sistema guarda los usuarios tanto en Cognito como en DynamoDB.
Para el primer admin creado via CLI, el registro DynamoDB debe crearse manualmente
o a través del resolver `createUser` una vez que el frontend esté funcionando.

```bash
# Obtener el sub (ID) del usuario en Cognito
COGNITO_SUB=$(aws cognito-idp admin-get-user \
  --user-pool-id $USER_POOL_ID \
  --username $ADMIN_EMAIL \
  --query "UserAttributes[?Name=='sub'].Value" \
  --output text \
  --profile mytascensores)

echo "Cognito Sub: $COGNITO_SUB"

# Generar un ULID (instalar si es necesario: npm install -g ulid)
USER_ID=$(node -e "const {ulid}=require('ulid');console.log(ulid())" 2>/dev/null || echo "01JADMIN000000000000000000")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

TABLE_NAME=$(aws cloudformation describe-stacks \
  --stack-name mytascensores-backoffice-database-dev \
  --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" \
  --output text \
  --profile mytascensores)

# Crear registro en DynamoDB
aws dynamodb put-item \
  --table-name $TABLE_NAME \
  --item "{
    \"PK\":         {\"S\": \"USER#$USER_ID\"},
    \"SK\":         {\"S\": \"METADATA\"},
    \"GSI1PK\":     {\"S\": \"USER#ADMIN\"},
    \"GSI1SK\":     {\"S\": \"$NOW\"},
    \"GSI2PK\":     {\"S\": \"COGNITO#$COGNITO_SUB\"},
    \"GSI2SK\":     {\"S\": \"$NOW\"},
    \"entityType\": {\"S\": \"USER\"},
    \"id\":         {\"S\": \"$USER_ID\"},
    \"cognitoId\":  {\"S\": \"$COGNITO_SUB\"},
    \"email\":      {\"S\": \"$ADMIN_EMAIL\"},
    \"firstName\":  {\"S\": \"$ADMIN_NOMBRE\"},
    \"lastName\":   {\"S\": \"$ADMIN_APELLIDO\"},
    \"role\":       {\"S\": \"ADMIN\"},
    \"status\":     {\"S\": \"ACTIVE\"},
    \"createdAt\":  {\"S\": \"$NOW\"},
    \"updatedAt\":  {\"S\": \"$NOW\"}
  }" \
  --profile mytascensores

echo "Registro de usuario creado en DynamoDB: $USER_ID"
```

---

## Paso 7 — Verificar el login en el frontend

```bash
cd /Users/manu/_PROYECTOS/mytascensores.cl/BACKOFFICE/frontend
npm run dev
```

1. Abrir `http://localhost:5173`
2. Iniciar sesión con `$ADMIN_EMAIL` y la contraseña permanente
3. Debe ingresar sin pedir cambio de contraseña
4. Verificar que el Authenticator muestra el nombre del usuario

---

## Crear usuarios adicionales (post-setup)

Una vez que hay un admin con acceso, los siguientes usuarios se crean
desde el propio backoffice a través de la mutation GraphQL:

```graphql
mutation CreateUser {
  createUser(input: {
    email:             "tecnico@mytascensores.cl"
    firstName:         "Juan"
    lastName:          "Pérez"
    role:              TECHNICIAN
    temporaryPassword: "Temp@2026!"
  }) {
    id
    email
    role
    status
  }
}
```

Esto crea el usuario en Cognito **y** en DynamoDB de forma atómica.

---

## Checklist RB-05

```
[ ] Usuario creado en Cognito  (admin-create-user)
[ ] Asignado al grupo ADMIN    (admin-add-user-to-group)
[ ] Contraseña permanente      (admin-set-user-password)
[ ] UserStatus = CONFIRMED
[ ] Registro en DynamoDB creado
[ ] Login exitoso en el frontend
```
