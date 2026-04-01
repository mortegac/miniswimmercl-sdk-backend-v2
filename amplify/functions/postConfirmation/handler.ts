import type { PostConfirmationTriggerHandler } from "aws-lambda";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Caché de tabla — se resuelve una vez por instancia Lambda (warm start)
let cachedTableName: string | null = null;

async function getV2UsersTableName(): Promise<string> {
  if (cachedTableName) return cachedTableName;

  // Busca eficientemente comenzando desde "v2Users-" (ExclusiveStartTableName
  // devuelve tablas DESPUÉS del valor dado en orden lexicográfico)
  const { TableNames } = await ddbClient.send(
    new ListTablesCommand({ ExclusiveStartTableName: "v2Use" })
  );
  const table = TableNames?.find((t) => t.startsWith("v2Users-"));
  if (!table) throw new Error("[postConfirmation] Tabla v2Users-* no encontrada");

  cachedTableName = table;
  return table;
}

export const handler: PostConfirmationTriggerHandler = async (event) => {
  // Solo actuar en confirmación de registro, no en reset de contraseña
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
    return event;
  }

  const { email, name, sub } = event.request.userAttributes;
  const now = new Date().toISOString();

  try {
    const tableName = await getV2UsersTableName();

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          id: sub,           // Cognito sub como PK — vincula ambos sistemas
          __typename: "v2Users",
          email,
          name: name ?? email.split("@")[0],
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression: "attribute_not_exists(id)", // no sobreescribir si ya existe
      })
    );
    console.log("[postConfirmation] v2Users creado para sub:", sub);
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      console.log("[postConfirmation] v2Users ya existe para sub:", sub);
    } else {
      console.error("[postConfirmation] Error al crear v2Users:", err);
      // No lanzar — no bloquear la confirmación del usuario
    }
  }

  return event;
};
