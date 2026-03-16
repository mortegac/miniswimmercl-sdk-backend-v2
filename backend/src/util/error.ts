import { logger } from "./log";

/**
 * Contexto estructurado para enriquecer errores con metadata.
 */
interface ErrorContext {
  [key: string]: unknown;
}

// ─── Overloads ────────────────────────────────────────────────────────────────

/** Lanza un error con mensaje simple. */
export function throwError(message: string): never;
/** Lanza un error envolviendo un error original. */
export function throwError(message: string, originalError: unknown): never;
/** Lanza un error con mensaje y contexto estructurado. */
export function throwError(message: string, context: ErrorContext): never;
/** Lanza un error agregando múltiples errores. */
export function throwError(errors: unknown[]): never;
/** Re-lanza un error existente después de loguearlo. */
export function throwError(error: Error): never;

export function throwError(
  messageOrError: string | Error | unknown[],
  originalErrorOrContext?: unknown
): never {
  let finalMessage: string;
  let errorContext: ErrorContext = {};
  let originalError: unknown;

  if (typeof messageOrError === "string") {
    finalMessage = messageOrError;

    if (originalErrorOrContext !== undefined) {
      if (originalErrorOrContext instanceof Error) {
        originalError = originalErrorOrContext;
        finalMessage = `${messageOrError}: ${originalErrorOrContext.message}`;
        errorContext = {
          originalError: {
            name: originalErrorOrContext.name,
            message: originalErrorOrContext.message,
            stack: originalErrorOrContext.stack,
          },
        };
      } else if (
        typeof originalErrorOrContext === "object" &&
        originalErrorOrContext !== null
      ) {
        errorContext = originalErrorOrContext as ErrorContext;
        originalError = originalErrorOrContext;
      } else {
        originalError = originalErrorOrContext;
        finalMessage = `${messageOrError}: ${String(originalErrorOrContext)}`;
        errorContext = { originalError: originalErrorOrContext };
      }
    }
  } else if (messageOrError instanceof Error) {
    finalMessage = messageOrError.message;
    originalError = messageOrError;
    errorContext = {
      originalError: {
        name: messageOrError.name,
        message: messageOrError.message,
        stack: messageOrError.stack,
      },
    };
  } else if (Array.isArray(messageOrError)) {
    const errorMessages = messageOrError.map((err) => {
      if (err instanceof Error) return err.message;
      if (typeof err === "object" && err !== null && "message" in err)
        return String((err as Record<string, unknown>)["message"]);
      return String(err);
    });
    finalMessage =
      errorMessages.length > 1
        ? `Multiple errors occurred: ${errorMessages.join("; ")}`
        : (errorMessages[0] ?? "Unknown error occurred");
    originalError = messageOrError;
    errorContext = { errors: messageOrError };
  } else {
    const unknownError = messageOrError as Record<string, unknown>;
    finalMessage =
      typeof unknownError === "object" && unknownError !== null && "message" in unknownError
        ? String(unknownError["message"])
        : `Unexpected error: ${String(unknownError)}`;
    originalError = unknownError;
    errorContext = { originalError: unknownError };
  }

  logger.error(finalMessage, {
    ...errorContext,
    errorType: typeof originalError,
    stack: new Error().stack,
  });

  const error = new Error(finalMessage);
  if (originalError instanceof Error && originalError.stack) {
    error.stack = `${error.stack}\n\nCaused by: ${originalError.stack}`;
  }

  throw error;
}

/**
 * Extrae el mensaje de cualquier tipo de error de forma segura.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error)
    return String((error as Record<string, unknown>)["message"]);
  if (Array.isArray(error)) return error.map(extractErrorMessage).join("; ");
  return String(error);
}

/**
 * Crea un objeto de contexto de error estructurado.
 * @example
 * throwError("Customer not found", createErrorContext({ customerId: id, operation: "getCustomer" }))
 */
export function createErrorContext(context: Record<string, unknown>): ErrorContext {
  return context;
}
