/**
 * Singleton Logger — adaptado desde EMA-back.
 * Structured JSON logging en AWS Lambda / CloudWatch.
 * Text logging en desarrollo local.
 */

export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

interface LogContext {
  requestId?: string;
  operation?: string;
  userId?: string;
  [key: string]: unknown;
}

interface StructuredLogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  data?: unknown;
  awsRequestId?: string;
  functionName?: string;
  xrayTraceId?: string;
  environment?: string;
}

class Logger {
  private static instance: Logger;
  private level: LogLevel = LogLevel.INFO;
  private context: LogContext = {};
  private useStructuredLogging = false;
  private environment: string;

  private constructor() {
    this.environment = this.detectEnvironment();
    this.useStructuredLogging = this.shouldUseStructuredLogging();
  }

  private detectEnvironment(): string {
    if (process.env["environment"] === "prod") return "production";

    const functionName = process.env["AWS_LAMBDA_FUNCTION_NAME"];
    if (functionName?.includes("-main-")) return "production";
    if (process.env["AWS_EXECUTION_ENV"]) return "aws-lambda";
    if (process.env["NODE_ENV"] === "production") return "production";

    return "development";
  }

  private shouldUseStructuredLogging(): boolean {
    if (process.env["STRUCTURED_LOGGING"] === "true") return true;
    if (process.env["STRUCTURED_LOGGING"] === "false") return false;
    return this.environment === "production" || this.environment === "aws-lambda";
  }

  public static getInstance(): Logger {
    if (!Logger.instance) Logger.instance = new Logger();
    return Logger.instance;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public getEnvironment(): string {
    return this.environment;
  }

  public setStructuredLogging(enabled: boolean): void {
    this.useStructuredLogging = enabled;
  }

  public setContext(newContext: Partial<LogContext>): void {
    this.context = { ...this.context, ...newContext };
  }

  public getContext(): LogContext {
    return { ...this.context };
  }

  public clearContext(): void {
    this.context = {};
  }

  private getAWSContext(): Partial<StructuredLogEntry> {
    const ctx: Partial<StructuredLogEntry> = { environment: this.environment };
    if (process.env["AWS_REQUEST_ID"]) ctx.awsRequestId = process.env["AWS_REQUEST_ID"];
    if (process.env["AWS_LAMBDA_FUNCTION_NAME"]) ctx.functionName = process.env["AWS_LAMBDA_FUNCTION_NAME"];
    if (process.env["_X_AMZN_TRACE_ID"]) ctx.xrayTraceId = process.env["_X_AMZN_TRACE_ID"];
    return ctx;
  }

  private createStructuredLog(level: string, message: string, data?: unknown): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.getAWSContext(),
    };
    if (Object.keys(this.context).length > 0) entry.context = this.context;
    if (data !== undefined) entry.data = data;
    return entry;
  }

  private formatWithContext(level: string, args: unknown[]): string {
    const contextStr =
      Object.keys(this.context).length > 0 ? ` ${JSON.stringify(this.context)}` : "";
    const argsStr = args
      .map((a) => {
        try {
          return typeof a === "string" ? a : JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    return `[${level}]${contextStr} ${argsStr}`;
  }

  private logMessage(level: LogLevel, levelName: string, ...args: unknown[]): void {
    if (this.level < level) return;

    if (this.useStructuredLogging) {
      const message = args.length > 0 ? String(args[0]) : "";
      const data = args.length > 1 ? args.slice(1) : undefined;
      const output = JSON.stringify(this.createStructuredLog(levelName, message, data));
      if (level === LogLevel.ERROR) console.error(output);
      else if (level === LogLevel.WARN) console.warn(output);
      else if (level === LogLevel.INFO) console.info(output);
      else console.debug(output);
    } else {
      const message = this.formatWithContext(levelName, args);
      if (level === LogLevel.ERROR) console.error(message);
      else if (level === LogLevel.WARN) console.warn(message);
      else if (level === LogLevel.INFO) console.info(message);
      else console.debug(message);
    }
  }

  public error(...args: unknown[]): void {
    this.logMessage(LogLevel.ERROR, "ERROR", ...args);
  }
  public warn(...args: unknown[]): void {
    this.logMessage(LogLevel.WARN, "WARN", ...args);
  }
  public info(...args: unknown[]): void {
    this.logMessage(LogLevel.INFO, "INFO", ...args);
  }
  public debug(...args: unknown[]): void {
    this.logMessage(LogLevel.DEBUG, "DEBUG", ...args);
  }
  public log(...args: unknown[]): void {
    console.log(...args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))));
  }
}

export const logger = Logger.getInstance();

try {
  const logLevel = parseInt(process.env["LOG_LEVEL"] ?? "3");
  logger.setLevel(logLevel as LogLevel);
} catch {
  logger.setLevel(LogLevel.INFO);
}
