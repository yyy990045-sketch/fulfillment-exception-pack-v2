/**
 * 最小结构化日志（JSON lines），不引入 observability stack。
 *
 * 字段：timestamp / level / event / requestId / tenantId / subjectId / method / path /
 * status / durationMs + 事件自定义字段。
 *
 * 敏感字段（authorization / cookie / jwt / password / secret / token / embedToken /
 * guestToken）在写出前被递归脱敏；错误日志只写稳定 error code，不打印上游原始 body。
 */
import { currentRequestContext } from "./request-context.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /(authorization|cookie|jwt|password|passwd|secret|token|embedtoken|guesttoken|apikey|api_key|credential)/i;
const BEARER_PATTERN = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

export const REDACTED = "[redacted]";

export function redactString(value: string) {
  return value.replace(BEARER_PATTERN, `$1 ${REDACTED}`).replace(JWT_PATTERN, REDACTED);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "undefined") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (SENSITIVE_KEY.test(key)) { out[key] = REDACTED; continue; }
      out[key] = redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(base: LogFields): Logger;
};

export type LoggerOptions = {
  level?: LogLevel;
  sink?: (line: string) => void;
  now?: () => Date;
  base?: LogFields;
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? ((process.env.LOG_LEVEL as LogLevel | undefined) ?? "info");
  const sink = options.sink ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const now = options.now ?? (() => new Date());
  const base = options.base ?? {};

  const log = (entryLevel: LogLevel, event: string, fields: LogFields = {}) => {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const context = currentRequestContext();
    const record = {
      timestamp: now().toISOString(),
      level: entryLevel,
      event,
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...(context?.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context?.subjectId ? { subjectId: context.subjectId } : {}),
      ...(redact(base) as LogFields),
      ...(redact(fields) as LogFields),
    };
    sink(JSON.stringify(record));
  };

  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
    child: (childBase) => createLogger({ ...options, level, base: { ...base, ...childBase } }),
  };
}

export const logger = createLogger();
