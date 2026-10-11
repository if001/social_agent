export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogValue = boolean | number | string | null | undefined;
export type LogContext = Readonly<Record<string, LogValue>>;

export interface Logger {
  child(context: LogContext): Logger;
  log(level: LogLevel, message: string, context?: LogContext): void;
}

export const noopLogger: Logger = {
  child: () => noopLogger,
  log: () => undefined
};

export type LogWriter = (line: string) => void;

const sanitizeErrorMessage = (message: string): string => message
  .replace(/\/\/[^/@\s]+:[^/@\s]+@/gu, "//[REDACTED]@")
  .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
  .replace(/\b(api[_-]?key|token|password|secret|credential|authorization)(\s*[:=]\s*)[^\s,;]+/giu, "$1$2[REDACTED]")
  .replaceAll(/[\r\n\t]+/gu, " ")
  .slice(0, 1_000);

function nestedErrorContext(error: Error): LogContext {
  const seen = new Set<unknown>([error]);
  let current: unknown = error.cause;
  const chain: { type: string; message: string }[] = [];
  for (let i = 0; i < 8 && current !== undefined && !seen.has(current); i += 1) {
    seen.add(current);
    if (current instanceof Error) {
      chain.push({ type: current.name, message: sanitizeErrorMessage(current.message) });
      current = current.cause;
    } else if (typeof current === "object" && current !== null && "providerError" in current) {
      current = current.providerError;
    } else break;
  }
  return chain.length === 0 ? {} : { errorCauses: JSON.stringify(chain) };
}

export function errorLogContext(error: unknown): LogContext {
  if (!(error instanceof Error)) return { errorType: typeof error, errorCode: "UNKNOWN", errorMessage: "Unknown non-Error value" };
  const record = error as Error & { readonly code?: unknown; readonly severity?: unknown; readonly schema?: unknown; readonly table?: unknown; readonly column?: unknown; readonly constraint?: unknown; readonly routine?: unknown };
  return {
    ...nestedErrorContext(error),
    errorType: error.name,
    errorCode: typeof record.code === "string" ? record.code : "UNKNOWN",
    errorMessage: sanitizeErrorMessage(error.message),
    ...(typeof record.severity === "string" ? { databaseSeverity: record.severity } : {}),
    ...(typeof record.schema === "string" ? { databaseSchema: record.schema } : {}),
    ...(typeof record.table === "string" ? { databaseTable: record.table } : {}),
    ...(typeof record.column === "string" ? { databaseColumn: record.column } : {}),
    ...(typeof record.constraint === "string" ? { databaseConstraint: record.constraint } : {}),
    ...(typeof record.routine === "string" ? { databaseRoutine: record.routine } : {})
  };
}

export function createStdoutLogger(base: LogContext = {}, writer: LogWriter = (line) => { process.stdout.write(line); }, now: () => Date = () => new Date()): Logger {
  const create = (context: LogContext): Logger => ({
    child: (childContext) => create({ ...context, ...childContext }),
    log: (level, step, eventContext = {}) => {
      const fields = Object.fromEntries(Object.entries({ ...context, ...eventContext }).filter(([, value]) => value !== undefined));
      writer(`${JSON.stringify({ timestamp: now().toISOString(), level, step, ...fields })}\n`);
    }
  });
  return create(base);
}
