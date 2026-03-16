import { logger } from "../log";

/**
 * Valida la respuesta de una operación DynamoDB.
 * Equivalente al validateResponse de EMA adaptado para operaciones DynamoDB SDK v3.
 */
export const validateDbResponse = <T>(props: {
  data: T | null | undefined;
  operation: string;
  entity: string;
  input?: unknown;
}): T => {
  const { data, operation, entity, input } = props;

  if (data === null || data === undefined) {
    const errorMsg = `No data returned for ${entity} ${operation}`;
    logger.error(errorMsg, input);
    throw new Error(errorMsg);
  }

  return data;
};
