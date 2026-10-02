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
