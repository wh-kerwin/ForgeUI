import type { RecordKey } from "../../../types/domain";
import { readPointer } from "./jsonPointer";

/**
 * Raw-typed record identity for explicit rowKey pointers.
 * Diagnostics are stable codes only: they never embed an ID or a field value.
 */
const KEY_MISSING = "record.key_missing";
const KEY_DUPLICATE = "record.key_duplicate";

export type RecordKeyResult = { key?: RecordKey; issue?: string };
export type CollectedKeys = {
  keys: (RecordKey | null)[];
  issues: string[];
  writable: boolean;
};

/**
 * Builds a typed identity from the raw value at `pointer` (relative to one record).
 * Valid raw types: non-blank string, finite number (including 0), boolean (including false).
 * `identity` is `${type}:${String(value)}` so string "001" and number 1 never collide;
 * `pathValue` is the URI-encoded raw text, never trimmed or reformatted.
 */
export function recordKeyAt(record: unknown, pointer: string): RecordKeyResult {
  const resolved = readPointer(record, pointer);
  if (!resolved.found) return { issue: KEY_MISSING };

  const raw = resolved.value;
  let type: RecordKey["type"];
  let value: string | number | boolean;
  if (typeof raw === "string") {
    if (raw.trim().length === 0) return { issue: KEY_MISSING };
    type = "string";
    value = raw;
  } else if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { issue: KEY_MISSING };
    type = "number";
    value = raw;
  } else if (typeof raw === "boolean") {
    type = "boolean";
    value = raw;
  } else {
    return { issue: KEY_MISSING };
  }

  const text = String(value);
  return {
    key: {
      type,
      value,
      identity: `${type}:${text}`,
      pathValue: encodeURIComponent(text),
    },
  };
}

/**
 * Collects one key per record (aligned by index), detects missing keys and
 * duplicate identities, and decides whether row writes may be enabled.
 * Issues are de-duplicated stable codes, bounded, and contain no ID values.
 */
export function collectRecordKeys(
  records: readonly unknown[],
  pointer: string,
): CollectedKeys {
  const keys: (RecordKey | null)[] = [];
  const identities = new Set<string>();
  let hasMissing = false;
  let hasDuplicate = false;

  for (const record of records) {
    const { key } = recordKeyAt(record, pointer);
    if (!key) {
      keys.push(null);
      hasMissing = true;
      continue;
    }
    keys.push(key);
    if (identities.has(key.identity)) hasDuplicate = true;
    else identities.add(key.identity);
  }

  // De-duplicated stable codes: at most one "missing" and one "duplicate",
  // so the list is inherently bounded regardless of response size.
  const issues: string[] = [];
  if (hasMissing) issues.push(KEY_MISSING);
  if (hasDuplicate) issues.push(KEY_DUPLICATE);

  return { keys, issues, writable: !hasMissing && !hasDuplicate };
}
