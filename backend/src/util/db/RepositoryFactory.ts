import { throwError } from "../error";
import { logger } from "../log";
import {
  getItem,
  putItem,
  updateItem,
  deleteItem as deleteDbItem,
  queryItems,
  decodeNextToken,
  type QueryParams,
} from "./client";
import { validateDbResponse } from "./validateResponse";
import type { Connection } from "../../types/appsync";

// ─── Types ────────────────────────────────────────────────────────────────────

type OperationType = "create" | "update" | "delete" | "get" | "list";

/**
 * Funciones de clave DynamoDB que define cada entidad.
 */
export interface EntityKeyConfig {
  pk: (id: string) => string;
  sk: () => string;
}

/**
 * Resultado del RepositoryFactory — CRUD tipado con logging y validación.
 * @template TDomain  Tipo de dominio (Customer, User, Webform)
 * @template TRecord  Tipo DynamoDB (con PK, SK, GSI...)
 * @template TCreate  Tipo de input para crear
 * @template TUpdate  Tipo de input para actualizar (parcial + id)
 */
export interface Repository<TDomain, TCreate, TUpdate extends { id: string }> {
  getById: (id: string) => Promise<TDomain | null>;
  create: (input: TCreate, createdBy: string) => Promise<TDomain>;
  update: (input: TUpdate) => Promise<TDomain>;
  remove: (id: string) => Promise<string>;
  query: (params: QueryParams & { limit?: number; nextToken?: string }) => Promise<Connection<TDomain>>;
}

/**
 * Configuración para crear un repositorio tipado.
 */
export interface RepositoryConfig<TDomain, TRecord, TCreate, TUpdate extends { id: string }> {
  entityName: string;
  keys: EntityKeyConfig;
  toRecord: (input: TCreate, id: string, now: string, createdBy: string) => TRecord;
  fromRecord: (record: TRecord) => TDomain;
  buildUpdatePayload?: (
    current: TRecord,
    input: TUpdate,
    now: string
  ) => Record<string, unknown>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Fábrica de repositorios DynamoDB tipados.
 * Inspirado en QueryFactory de EMA-back, adaptado para DynamoDB SDK v3 + single-table design.
 *
 * @example
 * const customerRepo = RepositoryFactory<Customer, CustomerRecord, CreateCustomerInput, UpdateCustomerInput>({
 *   entityName: 'Customer',
 *   keys: { pk: (id) => `CUSTOMER#${id}`, sk: () => 'METADATA' },
 *   toRecord: (input, id, now, createdBy) => ({ PK: ..., ...input, id, createdAt: now, createdBy }),
 *   fromRecord: ({ PK, SK, entityType, ...domain }) => domain as Customer,
 * });
 */
export function RepositoryFactory<
  TDomain,
  TRecord extends Record<string, unknown>,
  TCreate,
  TUpdate extends { id: string },
>(config: RepositoryConfig<TDomain, TRecord, TCreate, TUpdate>): Repository<TDomain, TCreate, TUpdate> {
  const { entityName, keys, toRecord, fromRecord, buildUpdatePayload } = config;

  // ─── Logging helpers ───────────────────────────────────────────────────────

  const logOperation = (operation: OperationType, data?: unknown): void => {
    const label = {
      create: "Creating",
      update: "Updating",
      delete: "Deleting",
      get: "Getting",
      list: "Listing",
    }[operation];
    logger.info(`${label} ${entityName}`, data ? { data } : undefined);
  };

  const logSuccess = (operation: OperationType, info?: unknown): void => {
    const label = {
      create: "created",
      update: "updated",
      delete: "deleted",
      get: "retrieved",
      list: "listed",
    }[operation];
    logger.info(`${entityName} ${label} successfully`, info ?? undefined);
  };

  // ─── Operations ────────────────────────────────────────────────────────────

  const getById = async (id: string): Promise<TDomain | null> => {
    try {
      logOperation("get", { id });
      const record = await getItem<TRecord>(keys.pk(id), keys.sk());
      if (!record) return null;
      logSuccess("get");
      return fromRecord(record);
    } catch (error) {
      throw throwError(`${entityName} could not be retrieved`, error);
    }
  };

  const create = async (input: TCreate, createdBy: string): Promise<TDomain> => {
    try {
      logOperation("create", input);
      const { ulid } = await import("ulid");
      const now = new Date().toISOString();
      const id = ulid();
      const record = toRecord(input, id, now, createdBy);
      await putItem(record as Record<string, unknown>);
      logSuccess("create");
      return fromRecord(record);
    } catch (error) {
      throw throwError(`${entityName} could not be created`, error);
    }
  };

  const update = async (input: TUpdate): Promise<TDomain> => {
    try {
      logOperation("update", input);
      const { id, ...rest } = input;
      const now = new Date().toISOString();

      let payload: Record<string, unknown>;

      if (buildUpdatePayload) {
        const current = await getItem<TRecord>(keys.pk(id), keys.sk());
        validateDbResponse({ data: current, operation: "update (get)", entity: entityName, input });
        payload = buildUpdatePayload(current!, input, now);
      } else {
        payload = { ...rest, updatedAt: now };
      }

      const updated = await updateItem(keys.pk(id), keys.sk(), payload);
      logSuccess("update");
      return fromRecord(updated as TRecord);
    } catch (error) {
      throw throwError(`${entityName} could not be updated`, error);
    }
  };

  const remove = async (id: string): Promise<string> => {
    try {
      logOperation("delete", { id });
      await deleteDbItem(keys.pk(id), keys.sk());
      logSuccess("delete");
      return id;
    } catch (error) {
      throw throwError(`${entityName} could not be deleted`, error);
    }
  };

  const query = async (
    params: QueryParams & { limit?: number; nextToken?: string }
  ): Promise<Connection<TDomain>> => {
    try {
      const { limit = 20, nextToken, ...queryParams } = params;
      logOperation("list", { limit, ...queryParams });

      const result = await queryItems<TRecord>({
        ...queryParams,
        Limit: limit,
        ExclusiveStartKey: decodeNextToken(nextToken),
      });

      logSuccess("list", { count: result.items.length });
      return {
        items: result.items.map(fromRecord),
        nextToken: result.nextToken,
      };
    } catch (error) {
      throw throwError(`${entityName} list could not be retrieved`, error);
    }
  };

  return { getById, create, update, remove, query };
}
