/**
 * Unified error-to-message conversion.
 *
 * Errors reach the UI from three very different sources:
 *  - Tauri IPC, which rejects with a string or a serialized Rust error object
 *  - the model provider layer, which rejects with Error instances or plain objects
 *  - local parsing/repair, which throws SyntaxError
 *
 * `String(error)` renders most of those as "[object Object]", so every catch
 * block routes through `toUserMessage` instead of stringifying directly.
 */

/** Keys a serialized error may carry its human-readable text under. */
const MESSAGE_KEYS = ["message", "error", "msg", "detail", "reason"] as const;

const UNKNOWN = "未知错误";

/**
 * Best-effort conversion of an unknown thrown value into text safe to show a
 * user. Never throws and never returns "[object Object]".
 */
export function toUserMessage(error: unknown): string {
  if (error === null || error === undefined) return UNKNOWN;

  if (typeof error === "string") return error.trim() || UNKNOWN;

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }

  if (error instanceof Error) return error.message.trim() || error.name || UNKNOWN;

  if (typeof error === "object") {
    const record = error as Record<string, unknown>;

    for (const key of MESSAGE_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      // Tauri sometimes wraps the real message one level down.
      if (value && typeof value === "object") {
        const nested = (value as Record<string, unknown>).message;
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }

    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}" && json !== "[]") return json;
    } catch {
      // Circular or otherwise non-serializable; fall through to UNKNOWN.
    }
  }

  return UNKNOWN;
}

/**
 * Converts an error for display and records it for diagnosis.
 *
 * Use this in catch blocks that would otherwise fail silently. `context` names
 * the failing operation and appears in the console so a report of "it did
 * nothing" can be traced back to a specific call site.
 */
export function reportError(context: string, error: unknown): string {
  console.error(`[${context}]`, error);
  return toUserMessage(error);
}
