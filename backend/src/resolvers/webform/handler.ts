import { RepositoryFactory } from "@db/RepositoryFactory";
import { throwError } from "@error";
import { logger } from "@log";
import { entityKeys, getItem, putItem } from "@db/client";
import type {
  Webform,
  WebformStatus,
  WebformType,
  CreateWebformInput,
  UpdateWebformInput,
} from "../../types/models";
import type { AppSyncEvent, ListFilter, Connection } from "../../types/appsync";

// ─── DynamoDB record type ─────────────────────────────────────────────────────

type WebformRecord = Webform & {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK?: string;
  GSI2SK?: string;
  entityType: "WEBFORM";
};

const WEBFORM_TYPES: WebformType[] = [
  "MAINTENANCE_REQUEST",
  "QUOTE_REQUEST",
  "EMERGENCY",
  "COMPLAINT",
  "GENERAL_INQUIRY",
];

// ─── Repository ───────────────────────────────────────────────────────────────

const webformRepo = RepositoryFactory<Webform, WebformRecord, CreateWebformInput, UpdateWebformInput>({
  entityName: "Webform",
  keys: entityKeys.webform,

  toRecord: (input, id, now) => ({
    PK: entityKeys.webform.pk(id),
    SK: entityKeys.webform.sk(),
    GSI1PK: entityKeys.webform.gsi1pk(input.type, "PENDING"),
    GSI1SK: entityKeys.webform.gsi1sk(now),
    entityType: "WEBFORM",
    id,
    ...input,
    status: "PENDING" as WebformStatus,
    createdAt: now,
    updatedAt: now,
  }),

  fromRecord: ({ PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g1s, GSI2PK: _g2, GSI2SK: _g2s, entityType: _et, ...domain }) =>
    domain as Webform,

  buildUpdatePayload: (current, input, now) => {
    const { id: _id, status, ...rest } = input;
    const payload: Record<string, unknown> = { ...rest, updatedAt: now };

    if (status && status !== current.status) {
      payload["status"] = status;
      payload["GSI1PK"] = entityKeys.webform.gsi1pk(current.type, status);
      if (status === "RESOLVED" && !rest.resolvedAt) {
        payload["resolvedAt"] = now;
      }
    }

    return payload;
  },
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function getWebform(
  event: AppSyncEvent<{ id: string }>
): Promise<Webform | null> {
  return webformRepo.getById(event.arguments.id);
}

export async function listWebforms(
  event: AppSyncEvent<{ filter?: ListFilter }>
): Promise<Connection<Webform>> {
  const { filter } = event.arguments;
  const status = filter?.status ?? "PENDING";
  const limit = filter?.limit ?? 20;

  // Consulta en paralelo por todos los tipos con ese status
  const results = await Promise.all(
    WEBFORM_TYPES.map((type) =>
      webformRepo.query({
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :gsi1pk",
        ExpressionAttributeValues: {
          ":gsi1pk": entityKeys.webform.gsi1pk(type, status),
        },
        ScanIndexForward: false,
        limit,
        nextToken: filter?.nextToken,
      })
    )
  );

  const items = results
    .flatMap((r) => r.items)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return { items };
}

export async function listWebformsByCustomer(
  event: AppSyncEvent<{ customerId: string; filter?: ListFilter }>
): Promise<Connection<Webform>> {
  const { customerId, filter } = event.arguments;

  return webformRepo.query({
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
    ExpressionAttributeValues: {
      ":pk": entityKeys.webform.customerPk(customerId),
      ":skPrefix": "WEBFORM#",
    },
    ScanIndexForward: false,
    limit: filter?.limit ?? 20,
    nextToken: filter?.nextToken,
  });
}

export async function createWebform(
  event: AppSyncEvent<{ input: CreateWebformInput }>
): Promise<Webform> {
  const { input } = event.arguments;
  const webform = await webformRepo.create(input, "public"); // webforms son públicos

  // Si tiene customerId, agregar referencia en la partición del customer
  if (input.customerId) {
    logger.info("Linking webform to customer", { customerId: input.customerId, webformId: webform.id });
    try {
      await putItem({
        PK: entityKeys.webform.customerPk(input.customerId),
        SK: entityKeys.webform.customerSk(webform.createdAt, webform.id),
        ...webform,
        entityType: "WEBFORM",
      });
    } catch (error) {
      // No crítico — no hacer rollback del webform principal
      logger.warn("Failed to link webform to customer partition", { error });
    }
  }

  return webform;
}

export async function updateWebform(
  event: AppSyncEvent<{ input: UpdateWebformInput }>
): Promise<Webform> {
  return webformRepo.update(event.arguments.input);
}

export async function assignWebform(
  event: AppSyncEvent<{ id: string; userId: string }>
): Promise<Webform> {
  const { id, userId } = event.arguments;
  const now = new Date().toISOString();

  const record = await getItem<WebformRecord>(
    entityKeys.webform.pk(id),
    entityKeys.webform.sk()
  );
  if (!record) throwError(`Webform ${id} not found`);

  logger.info("Assigning webform", { webformId: id, userId });

  return webformRepo.update({
    id,
    status: "IN_REVIEW" as WebformStatus,
    assignedTo: userId,
  });
}
