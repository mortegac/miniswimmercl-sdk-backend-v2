# Runbooks — MytAscensores Backoffice

Procedimientos operacionales paso a paso para deploy y mantenimiento en AWS.

## Índice

| # | Runbook | Cuándo usarlo |
|---|---------|---------------|
| [RB-01](./RB-01-prerequisitos.md) | Prerrequisitos y setup local | Primera vez que trabajas en el proyecto |
| [RB-02](./RB-02-primer-deploy.md) | Primer deploy completo (desde cero) | Cuenta AWS nueva o ambiente nuevo |
| [RB-03](./RB-03-deploy-backend.md) | Deploy solo del backend | Cambios en resolvers / lógica Lambda |
| [RB-04](./RB-04-deploy-infraestructura.md) | Deploy de infraestructura | Cambios en CDK stacks |
| [RB-05](./RB-05-primer-usuario-admin.md) | Crear primer usuario administrador | Después del primer deploy |
| [RB-06](./RB-06-deploy-produccion.md) | Deploy a producción | Release a prod |
| [RB-07](./RB-07-verificacion.md) | Verificación post-deploy | Después de cualquier deploy |
| [RB-08](./RB-08-rollback.md) | Rollback | Cuando un deploy falla en prod |
| [RB-09](./RB-09-troubleshooting.md) | Troubleshooting | Errores frecuentes y soluciones |

## Recursos nombrados en AWS

```
Stage: dev
  Stack Auth:     mytascensores-backoffice-auth-dev
  Stack Database: mytascensores-backoffice-database-dev
  Stack API:      mytascensores-backoffice-api-dev
  Lambda:         mytascensores-backoffice-resolver-dev
  DynamoDB:       mytascensores-backoffice-dev
  AppSync:        mytascensores-backoffice-dev
  Cognito Pool:   mytascensores-backoffice-dev

Stage: prod
  (mismos nombres con sufijo -prod)
```

## Convenciones

- `{ACCOUNT_ID}` → ID numérico de tu cuenta AWS (12 dígitos)
- `{REGION}` → región AWS, por defecto `us-east-1`
- `{STAGE}` → `dev` o `prod`
- `[OUTPUT]` → valor obtenido del output del CDK tras el deploy
- Comandos marcados con `⚠️` requieren confirmación antes de ejecutar
