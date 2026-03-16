# Arquitectura — MytAscensores Backoffice

Documentación técnica de la arquitectura del sistema.

## Índice

| Archivo | Contenido |
|---|---|
| [01-vision-general.md](./01-vision-general.md) | Diagrama de sistema completo, capas y flujo de datos |
| [02-infraestructura.md](./02-infraestructura.md) | AWS CDK, stacks, recursos cloud |
| [03-autenticacion.md](./03-autenticacion.md) | Cognito, user pools, grupos y flujo de auth |
| [04-api-graphql.md](./04-api-graphql.md) | AppSync, schema, resolvers, subscriptions |
| [05-base-de-datos.md](./05-base-de-datos.md) | DynamoDB single-table design, access patterns, GSI |
| [06-backend-patterns.md](./06-backend-patterns.md) | RepositoryFactory, Logger, throwError, estructura de código |
| [07-frontend.md](./07-frontend.md) | React, Redux Toolkit, Vite, integración con AppSync |
| [08-deployment.md](./08-deployment.md) | Pipeline de deploy, environments, comandos |

## Stack tecnológico

```
Frontend          Backend           Infrastructure
──────────        ──────────        ──────────────
React 19          Node.js 22        AWS CDK v2
Redux Toolkit     TypeScript 5.8    AWS AppSync
Vite              AWS Lambda        AWS DynamoDB
aws-amplify v6    AWS SDK v3        AWS Cognito
                  esbuild           CloudWatch / X-Ray
```

## Principios de diseño

- **Serverless first** — sin servidores que mantener
- **Single-table DynamoDB** — un acceso a BD por operación
- **Type-safe end-to-end** — TypeScript en toda la cadena
- **Infrastructure as Code** — CDK como fuente de verdad
- **Observabilidad** — structured logging + X-Ray tracing
