# RB-01 — Prerrequisitos y Setup Local

**Cuándo usar:** Primera vez que trabajas en el proyecto o en una máquina nueva.

---

## 1. Herramientas requeridas

### Node.js 22+

```bash
# Verificar versión
node --version
# Debe mostrar: v22.x.x

# Si no está instalado, usar nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
nvm use 22
nvm alias default 22
```

### AWS CLI v2

```bash
# Verificar
aws --version
# Debe mostrar: aws-cli/2.x.x

# Si no está instalado (macOS):
brew install awscli

# Verificar con Linux:
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install
```

### AWS CDK CLI

```bash
# Verificar
cdk --version
# Debe mostrar: 2.x.x

# Instalar globalmente
npm install -g aws-cdk@latest
```

---

## 2. Configurar credenciales AWS

### Opción A — Perfil nombrado (recomendado)

```bash
aws configure --profile mytascensores
```

Ingresar cuando lo pida:
```
AWS Access Key ID:     [tu access key]
AWS Secret Access Key: [tu secret key]
Default region name:   us-east-1
Default output format: json
```

Verificar que funciona:
```bash
aws sts get-caller-identity --profile mytascensores
```

Respuesta esperada:
```json
{
    "UserId": "AIDAXXXXXXXXXXXXXXXXX",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/tu-usuario"
}
```

### Opción B — Variables de entorno (CI/CD)

```bash
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1
```

---

## 3. Permisos IAM mínimos requeridos

El usuario o rol AWS necesita estas políticas para poder hacer deploy:

```
AdministratorAccess          (más simple, recomendado para desarrollo)

O permisos granulares:
  AWSCloudFormationFullAccess
  AmazonDynamoDBFullAccess
  AmazonCognitoPowerUser
  AWSAppSyncAdministrator
  AWSLambda_FullAccess
  IAMFullAccess                ← requerido por CDK para crear roles
  CloudWatchLogsFullAccess
  AmazonS3FullAccess           ← CDK usa S3 para assets
```

---

## 4. Clonar e instalar dependencias

```bash
# Clonar el repositorio
git clone [URL_REPOSITORIO]
cd BACKOFFICE

# Instalar todas las dependencias (monorepo npm workspaces)
npm install

# Verificar que los 3 workspaces se instalaron
ls infrastructure/node_modules  # debe existir
ls backend/node_modules          # debe existir
ls frontend/node_modules         # debe existir
```

---

## 5. Variables de entorno locales

```bash
# Copiar el template
cp frontend/.env.example frontend/.env.local

# El archivo tendrá valores placeholder:
# VITE_AWS_REGION=us-east-1
# VITE_USER_POOL_ID=us-east-1_XXXXXXXXX
# VITE_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
# VITE_GRAPHQL_ENDPOINT=https://XXXXXXXXXX.appsync-api.us-east-1.amazonaws.com/graphql

# Los valores reales se obtienen después del primer deploy (RB-02)
```

---

## 6. Verificar el setup completo

```bash
# TypeScript compila correctamente
cd backend && npm run typecheck
# Esperado: sin errores

# Tests pasan
cd backend && npm run test
# Esperado: all tests passed

# CDK puede sintetizar (no requiere credenciales reales)
cd infrastructure && npx cdk synth --app "npx ts-node bin/app.ts" -c stage=dev
# Esperado: genera archivos en cdk.out/
```

---

## 7. Setup del editor (VS Code recomendado)

Extensiones útiles:
```
GraphQL: Language Feature Support  → resaltado en *.graphql
ESLint                             → lint en tiempo real
Prettier                           → formato automático
AWS Toolkit                        → integración con AWS desde el IDE
Thunder Client                     → pruebas GraphQL
```

`.vscode/settings.json` recomendado (crear en la raíz):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib",
  "[graphql]": {
    "editor.formatOnSave": false
  }
}
```

---

## Checklist final RB-01

```
[ ] node --version    → v22.x.x
[ ] aws --version     → aws-cli/2.x.x
[ ] cdk --version     → 2.x.x
[ ] aws sts get-caller-identity --profile mytascensores  → responde con Account ID
[ ] npm install       → sin errores
[ ] npm run typecheck (backend) → sin errores
[ ] npm run test (backend)      → tests pasan
```

Continuar con → [RB-02 Primer Deploy](./RB-02-primer-deploy.md)
