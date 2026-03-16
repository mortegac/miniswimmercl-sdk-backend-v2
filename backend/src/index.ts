import { logger } from "@log";
import { extractErrorMessage } from "@error";
import type { AppSyncEvent } from "./types/appsync";

import * as customer from "./resolvers/customer/handler";
import * as user from "./resolvers/user/handler";
import * as webform from "./resolvers/webform/handler";

type ResolverFn = (event: AppSyncEvent<never>) => Promise<unknown>;

const resolverMap: Record<string, ResolverFn> = {
  "Query.getCustomer": customer.getCustomer as ResolverFn,
  "Query.listCustomers": customer.listCustomers as ResolverFn,
  "Query.searchCustomers": customer.searchCustomers as ResolverFn,
  "Mutation.createCustomer": customer.createCustomer as ResolverFn,
  "Mutation.updateCustomer": customer.updateCustomer as ResolverFn,
  "Mutation.deleteCustomer": customer.deleteCustomer as ResolverFn,

  "Query.getUser": user.getUser as ResolverFn,
  "Query.getCurrentUser": user.getCurrentUser as ResolverFn,
  "Query.listUsers": user.listUsers as ResolverFn,
  "Mutation.createUser": user.createUser as ResolverFn,
  "Mutation.updateUser": user.updateUser as ResolverFn,
  "Mutation.deactivateUser": user.deactivateUser as ResolverFn,

  "Query.getWebform": webform.getWebform as ResolverFn,
  "Query.listWebforms": webform.listWebforms as ResolverFn,
  "Query.listWebformsByCustomer": webform.listWebformsByCustomer as ResolverFn,
  "Mutation.createWebform": webform.createWebform as ResolverFn,
  "Mutation.updateWebform": webform.updateWebform as ResolverFn,
  "Mutation.assignWebform": webform.assignWebform as ResolverFn,
};

export const handler = async (event: AppSyncEvent<never>): Promise<unknown> => {
  const key = `${event.typeName}.${event.fieldName}`;

  // Contexto global para todos los logs de esta invocación (patrón EMA)
  logger.setContext({
    operation: key,
    userId: event.identity?.sub,
    requestId: event.request?.headers?.["x-amzn-requestid"],
  });

  try {
    logger.info("Resolver invoked", { arguments: event.arguments });

    const resolver = resolverMap[key];
    if (!resolver) {
      logger.error(`No resolver found for ${key}`);
      throw new Error(`No resolver found for ${key}`);
    }

    const result = await resolver(event);
    logger.info("Resolver completed successfully");
    return result;
  } catch (error) {
    const message = extractErrorMessage(error);
    logger.error("Resolver failed", { message });
    throw new Error(message);
  } finally {
    // Limpiar contexto para evitar leaks entre invocaciones (patrón EMA)
    logger.clearContext();
  }
};
