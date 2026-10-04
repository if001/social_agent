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
