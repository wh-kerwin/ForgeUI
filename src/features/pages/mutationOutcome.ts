/** Terminal outcome of a write; callers must not close a form on a non-success result. */
export type MutationOutcome = "success" | "error" | "unknown" | "skipped";

export type FieldErrors = Record<string, string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Backend field errors are bounded and keyed by declared field name. Values are
 * server-authored messages, never copied request bodies or credentials.
 */
export function fieldErrorsFrom(error: unknown): FieldErrors {
  if (!isRecord(error)) return {};
  const body = isRecord(error.body) ? error.body : undefined;
  const candidate = error.fieldErrors ?? body?.errors ?? body?.fieldErrors;
  if (!isRecord(candidate)) return {};
  const result: FieldErrors = {};
  for (const [name, value] of Object.entries(candidate).slice(0, 50)) {
    if (name.length > 64) continue;
    const message = Array.isArray(value) ? value[0] : value;
    if (typeof message === "string" && message.trim()) result[name] = message.slice(0, 200);
  }
  return result;
}
