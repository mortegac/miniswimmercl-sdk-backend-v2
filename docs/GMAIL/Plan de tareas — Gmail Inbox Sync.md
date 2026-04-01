Plan de tareas — Gmail Inbox Sync

  Arquitectura

  Gmail API ──► Lambda (gmailSync) ──► DynamoDB (v2GmailInbox)
                     ▲                        │
              EventBridge Cron         AppSync GraphQL
             (diario 08:00 AM)               │
                                       Frontend / Backoffice

  Auth Gmail: OAuth2 con refresh token almacenado en AWS Secrets Manager. Un script local hace la autorización inicial (una sola vez), guarda el refresh token, y la Lambda lo renueva automáticamente en cada ejecución.

  ---
  Fase 1 — Configuración Google Cloud (manual, prerequisito)

  Tarea 1.1 — Crear proyecto y habilitar API
  - Ir a console.cloud.google.com
  - Crear proyecto miniswimmer-gmail-sync
  - Habilitar Gmail API

  Tarea 1.2 — Crear credenciales OAuth2
  - Tipo: Desktop app (para el script de autorización inicial)
  - Descargar credentials.json
  - Agregar el email de Gmail como Test user en OAuth consent screen

  Tarea 1.3 — Obtener refresh token (script local, una sola vez)
  - Script Node.js que abre browser para autorizar
  - Scopes necesarios: gmail.readonly
  - Guarda access_token + refresh_token + client_id + client_secret

  Tarea 1.4 — Guardar en AWS Secrets Manager
  {
    "client_id": "xxx.apps.googleusercontent.com",
    "client_secret": "GOCSPX-xxx",
    "refresh_token": "1//xxx",
    "gmail_account": "hola@miniswimmer.cl"
  }
  aws secretsmanager create-secret \
    --name "miniswimmer/gmail-oauth" \
    --secret-string '{"client_id":"..."}' \
    --profile miniswimmer --region us-east-2

  ---
  Fase 2 — Schema DynamoDB + GraphQL

  Tarea 2.1 — Crear amplify/data/schema/gmailInbox.ts

  v2GmailInbox: a.model({
    messageId:      a.string().required(),  // Gmail ID único (para dedup)
    threadId:       a.string().required(),
    subject:        a.string(),
    fromEmail:      a.string(),
    fromName:       a.string(),
    toEmails:       a.string().array(),
    dateSent:       a.datetime().required(),
    dateStr:        a.string().required(),  // "YYYY-MM-DD" para GSI por fecha
    snippet:        a.string(),             // preview 160 chars (Gmail)
    bodyText:       a.string(),             // cuerpo plain text
    bodyHtml:       a.string(),             // cuerpo HTML
    labels:         a.string().array(),     // ["INBOX","UNREAD","CATEGORY_PERSONAL"]
    isRead:         a.boolean().default(false),
    hasAttachments: a.boolean().default(false),
    attachments:    a.json(),               // [{filename, mimeType, size, attachmentId}]
    gmailAccount:   a.string().required(),  // "hola@miniswimmer.cl"
  })
  .secondaryIndexes((index) => [
    index("messageId").name("byMessageId"),          // dedup: verificar si ya existe
    index("gmailAccount")
      .sortKeys(["dateSent"]).name("byAccountDate"), // listar emails por cuenta y fecha
    index("fromEmail").name("byFromEmail"),          // filtrar por remitente
    index("dateStr").name("byDate"),                 // listar por día
  ])
  .authorization((allow) => [allow.authenticated()])

  Tarea 2.2 — Agregar al data/resource.ts
  - Importar y añadir gmailInboxSchema al a.combine([...])

  Tarea 2.3 — Deploy schema
  - ampx sandbox detecta el cambio y crea la tabla + GSIs

  ---
  Fase 3 — Lambda gmailSync

  Tarea 3.1 — amplify/functions/gmailSync/resource.ts
  export const gmailSyncFn = defineFunction({
    name: "gmailSyncV2",
    entry: "./handler.ts",
    runtime: 20,
    timeoutSeconds: 300,    // 5 min — puede procesar muchos emails
    memoryMB: 512,
    resourceGroupName: "data",
  });

  Tarea 3.2 — amplify/functions/gmailSync/handler.ts

  Lógica principal:
  1. Leer credenciales desde Secrets Manager
  2. Crear OAuth2 client y hacer refresh del access_token
  3. Calcular fecha de hace 7 días (query Gmail: "after:YYYY/MM/DD")
  4. gmail.users.messages.list() con paginación (máx 500 mensajes)
  5. Por cada messageId → gmail.users.messages.get() (headers + body + labels)
  6. Verificar dedup: QueryCommand por GSI "byMessageId"
  7. Si no existe → PutCommand en v2GmailInbox
  8. Log resumen: X emails nuevos, Y ya existían, Z errores

  Dependencia a instalar: "googleapis": "^144.0.0" en amplify/package.json

  Tarea 3.3 — amplify/backend.ts — configurar la Lambda:
  const gmailLambda = backend.gmailSyncFn.resources.lambda;
  const gmailTable  = backend.data.resources.tables["v2GmailInbox"];

  // DynamoDB
  gmailTable.grantReadWriteData(gmailLambda);
  gmailLambda.addEnvironment("GMAIL_INBOX_TABLE", gmailTable.tableName);

  // Secrets Manager
  gmailLambda.addToRolePolicy(new PolicyStatement({
    actions: ["secretsmanager:GetSecretValue"],
    resources: [`arn:aws:secretsmanager:us-east-2:995007408497:secret:miniswimmer/gmail-oauth*`],
  }));
  gmailLambda.addEnvironment("GMAIL_SECRET_NAME", "miniswimmer/gmail-oauth");

  // EventBridge cron: diario 11:00 UTC = 08:00 Santiago
  new Rule(Stack.of(gmailLambda), "GmailSyncDailyRule", {
    schedule: Schedule.cron({ hour: "11", minute: "0" }),
    targets: [new LambdaTarget(gmailLambda)],
  });

  ---
  Fase 4 — GraphQL disponible automáticamente

  Amplify Gen 2 genera automáticamente:

  # Queries disponibles sin código extra:
  query GetV2GmailInbox($id: ID!)
  query ListV2GmailInboxes(filter, limit, nextToken)
  query ListV2GmailInboxesByMessageId($messageId: String!)
  query ListV2GmailInboxesByAccountDate($gmailAccount: String!, $dateSent: ...)
  query ListV2GmailInboxesByFromEmail($fromEmail: String!)
  query ListV2GmailInboxesByDate($dateStr: String!)

  Si se requiere búsqueda full-text (por asunto/cuerpo), se añade una Lambda custom en Fase 4+.

  ---
  Fase 5 — Deploy y verificación

  Tarea 5.1 — Deploy backend completo (ampx sandbox)
  Tarea 5.2 — Trigger manual de la Lambda para verificar
  Tarea 5.3 — Verificar datos en DynamoDB console
  Tarea 5.4 — Test de queries en AppSync console
  Tarea 5.5 — Verificar cron con EventBridge

  ---
  Orden de ejecución

  [1.1→1.4]  Prerequisito manual (Google Cloud + Secrets Manager)
      │
  [2.1→2.3]  Schema + deploy (puedo hacer esto ahora)
      │
  [3.1→3.3]  Lambda handler + backend config
      │
  [4]        GraphQL disponible automáticamente
      │
  [5.1→5.5]  Deploy + pruebas

  ---
  ¿Quieres que empiece con la implementación? Para avanzar necesito que completes la Tarea 1.1–1.4 (Google Cloud + Secrets Manager) ya que requiere acceso manual al browser para el OAuth2. Las tareas 2, 3, 4 y 5 las implemento yo.

  ¿El email de Gmail que se va a conectar es hola@miniswimmer.cl u otro? ¿Es una cuenta de Google Workspace o Gmail personal?
