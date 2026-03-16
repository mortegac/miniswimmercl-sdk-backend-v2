import { ulid } from "ulid";
import { RepositoryFactory } from "@db/RepositoryFactory";
import { throwError } from "@error";
import { entityKeys, queryItems, decodeNextToken } from "@db/client";
import type {
  Customer,
  CustomerStatus,
  CreateCustomerInput,
  UpdateCustomerInput,
} from "../../types/models";
import type { AppSyncEvent, ListFilter, Connection } from "../../types/appsync";

// ─── DynamoDB record type ─────────────────────────────────────────────────────

type CustomerRecord = Customer & {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: "CUSTOMER";
};

// ─── Repository ───────────────────────────────────────────────────────────────

const customerRepo = RepositoryFactory<
  Customer,
  CustomerRecord,
  CreateCustomerInput,
  UpdateCustomerInput
>({
  entityName: "Customer",
  keys: entityKeys.customer,

  toRecord: (input, id, now, createdBy) => ({
    PK: entityKeys.customer.pk(id),
    SK: entityKeys.customer.sk(),
    GSI1PK: entityKeys.customer.gsi1pk("ACTIVE"),
    GSI1SK: entityKeys.customer.gsi1sk(now),
    entityType: "CUSTOMER",
    id,
    ...input,
    status: "ACTIVE" as CustomerStatus,
    createdAt: now,
    updatedAt: now,
    createdBy,
  }),

  fromRecord: ({ PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, entityType: _et, ...domain }) =>
    domain as Customer,

  buildUpdatePayload: (current, input, now) => {
    const { id: _id, status, ...rest } = input;
    const payload: Record<string, unknown> = { ...rest, updatedAt: now };
    if (status && status !== current.status) {
      payload["status"] = status;
      payload["GSI1PK"] = entityKeys.customer.gsi1pk(status);
    }
    return payload;
  },
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function getCustomer(
  event: AppSyncEvent<{ id: string }>
): Promise<Customer | null> {
  return customerRepo.getById(event.arguments.id);
}

export async function listCustomers(
  event: AppSyncEvent<{ filter?: ListFilter }>
): Promise<Connection<Customer>> {
  const { filter } = event.arguments;
  const status = filter?.status ?? "ACTIVE";

  return customerRepo.query({
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :gsi1pk",
    ExpressionAttributeValues: { ":gsi1pk": entityKeys.customer.gsi1pk(status) },
    ScanIndexForward: false,
    limit: filter?.limit ?? 20,
    nextToken: filter?.nextToken,
  });
}

export async function searchCustomers(
  event: AppSyncEvent<{ query: string; filter?: ListFilter }>
): Promise<Connection<Customer>> {
  const { query, filter } = event.arguments;

  return customerRepo.query({
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :gsi1pk",
    FilterExpression:
      "contains(#companyName, :q) OR contains(#rut, :q) OR contains(#email, :q)",
    ExpressionAttributeNames: {
      "#companyName": "companyName",
      "#rut": "rut",
      "#email": "email",
    },
    ExpressionAttributeValues: {
      ":gsi1pk": entityKeys.customer.gsi1pk("ACTIVE"),
      ":q": query,
    },
    limit: filter?.limit ?? 20,
    nextToken: filter?.nextToken,
  });
}

export async function createCustomer(
  event: AppSyncEvent<{ input: CreateCustomerInput }>
): Promise<Customer> {
  return customerRepo.create(event.arguments.input, event.identity.sub);
}

export async function updateCustomer(
  event: AppSyncEvent<{ input: UpdateCustomerInput }>
): Promise<Customer> {
  return customerRepo.update(event.arguments.input);
}

export async function deleteCustomer(
  event: AppSyncEvent<{ id: string }>
): Promise<string> {
  return customerRepo.remove(event.arguments.id);
}
