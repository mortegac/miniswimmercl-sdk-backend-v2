/**
 * Tipos base para AppSync Lambda resolvers.
 * AppSync envía un evento con información sobre la operación GraphQL.
 */

export interface AppSyncIdentityCognito {
  sub: string;
  issuer: string;
  username: string;
  claims: Record<string, unknown>;
  sourceIp: string[];
  defaultAuthStrategy: string;
}

export interface AppSyncEvent<TArgs = Record<string, unknown>> {
  typeName: "Query" | "Mutation" | "Subscription";
  fieldName: string;
  arguments: TArgs;
  identity: AppSyncIdentityCognito;
  source: unknown;
  request: {
    headers: Record<string, string>;
    domainName: string | null;
  };
  info: {
    fieldName: string;
    parentTypeName: string;
    variables: Record<string, unknown>;
    selectionSetList: string[];
    selectionSetGraphQL: string;
  };
}

export interface ListFilter {
  limit?: number;
  nextToken?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface Connection<T> {
  items: T[];
  nextToken?: string;
  total?: number;
}
