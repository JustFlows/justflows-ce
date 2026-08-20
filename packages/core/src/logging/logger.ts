export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class ConsoleLogger implements Logger {
  private readonly minLevel: number;
  private readonly bindings: Record<string, unknown>;

  constructor(level: LogLevel = "info", bindings: Record<string, unknown> = {}) {
    this.minLevel = LEVEL_PRIORITY[level];
    this.bindings = bindings;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < this.minLevel) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(Object.keys(this.bindings).length > 0 || context
        ? { context: { ...this.bindings, ...context } }
        : {}),
    };

    const output = JSON.stringify(entry);

    if (level === "error" || level === "warn") {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  child(bindings: Record<string, unknown>): Logger {
    const level = (Object.entries(LEVEL_PRIORITY).find(([, v]) => v === this.minLevel)?.[0] ??
      "info") as LogLevel;
    return new ConsoleLogger(level, { ...this.bindings, ...bindings });
  }
}

export function createLogger(level: LogLevel = "info"): Logger {
  return new ConsoleLogger(level);
}
