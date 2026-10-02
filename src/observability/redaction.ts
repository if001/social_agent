const SECRET_KEY = /(?:api[_-]?key|token|password|secret|credential|authorization)/i;
const REDACTED = "[REDACTED]";

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? REDACTED : redactSecrets(item)]));
  }
  return value;
}
