import type { RecordKey, ResponseBinding } from "../../../types/domain";
import { isPlainObject, readPointer } from "./jsonPointer";
import { collectRecordKeys } from "./recordKey";

/**
 * Deterministic, explicit mapping of one API response into UI records.
 * Records stay raw (typed, unformatted, complete) so a nested rowKeyPointer
 * can still resolve an identity. Only a confirmed, fully valid mapping is writable.
 * No v1 runtime helpers, LIST_KEYS guessing, or mapRealDataResponse is used here.
 */
export const MAX_MAPPED_ROWS = 100;
export const MAX_MAPPED_FIELDS = 50;

export type MappingIssue = { code: string; message: string; pointer?: string };
export type ResponseMappingResult = {
  status: "mapped" | "empty" | "invalid" | "unconfirmed";
  records: Record<string, unknown>[];
  keys: (RecordKey | null)[];
  total?: number;
  issues: MappingIssue[];
  truncated: { rows: boolean; fields: boolean };
  writable: boolean;
};

const ITEMS_NOT_ARRAY = "response.items_not_array";
const RECORD_SKIPPED = "response.record_skipped";
const TOTAL_INVALID = "response.total_invalid";
const TOTAL_NEGATIVE = "response.total_negative";

function limit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

/** total is read only from an explicit totalPointer; never inferred from rows. */
function resolveTotal(
  body: unknown,
  pointer: string | undefined,
  issues: MappingIssue[],
): number | undefined {
  // An empty pointer addresses the root value; a total must always be a
  // scalar at an explicit path, so it means "not provided" here.
  if (typeof pointer !== "string" || pointer === "") return undefined;
  const resolved = readPointer(body, pointer);
  const value = resolved.found ? resolved.value : undefined;
  if (
    !resolved.found ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    issues.push({ code: TOTAL_INVALID, message: TOTAL_INVALID, pointer });
    return undefined;
  }
  if (value < 0) {
    issues.push({ code: TOTAL_NEGATIVE, message: TOTAL_NEGATIVE, pointer });
    return undefined;
  }
  return value;
}

/** Keeps raw, complete record objects; shallow copies isolate the input body. */
function collectRecords(items: readonly unknown[]): {
  records: Record<string, unknown>[];
  skipped: number;
} {
  const records: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const item of items) {
    if (!isPlainObject(item)) {
      skipped += 1;
      continue;
    }
    records.push({ ...item });
  }
  return { records, skipped };
}

/** Mirrors key-level diagnostics into bounded, data-free MappingIssues. */
function appendKeyIssues(
  codes: readonly string[],
  pointer: string,
  issues: MappingIssue[],
): void {
  for (const code of codes) {
    issues.push({ code, message: code, pointer });
  }
}

/**
 * Maps `body` by the explicit `binding` pointers.
 * `""` itemsPointer addresses a root array; anything else must resolve to an array.
 * `truncated.fields` marks an over-limit display-field configuration: records are
 * intentionally NOT projected, so consumers render the first maxFields fieldPointers.
 */
export function mapResponse(
  body: unknown,
  binding: ResponseBinding,
  options?: { maxRows?: number; maxFields?: number },
): ResponseMappingResult {
  const maxRows = limit(options?.maxRows, MAX_MAPPED_ROWS);
  const maxFields = limit(options?.maxFields, MAX_MAPPED_FIELDS);
  const issues: MappingIssue[] = [];
  const truncated = {
    rows: false,
    fields:
      (Array.isArray(binding.fieldPointers) ? binding.fieldPointers.length : 0) > maxFields,
  };
  const total = resolveTotal(body, binding.totalPointer, issues);

  const itemsResult = readPointer(body, binding.itemsPointer);
  if (!itemsResult.found || !Array.isArray(itemsResult.value)) {
    issues.push({
      code: ITEMS_NOT_ARRAY,
      message: ITEMS_NOT_ARRAY,
      pointer: binding.itemsPointer,
    });
    return {
      status: "invalid",
      records: [],
      keys: [],
      ...(total !== undefined ? { total } : {}),
      issues,
      truncated,
      writable: false,
    };
  }
  const items: readonly unknown[] = itemsResult.value;

  const { records, skipped } = collectRecords(items);
  if (skipped > 0) {
    issues.push({ code: RECORD_SKIPPED, message: `${RECORD_SKIPPED}:count=${skipped}` });
  }
  truncated.rows = records.length > maxRows;
  if (truncated.rows) records.length = maxRows;

  const keyResult = collectRecordKeys(records, binding.rowKeyPointer);
  appendKeyIssues(keyResult.issues, binding.rowKeyPointer, issues);

  const status: ResponseMappingResult["status"] =
    items.length === 0
      ? "empty"
      : binding.confirmed === false
        ? "unconfirmed"
        : "mapped";
  const writable =
    binding.confirmed === true &&
    status === "mapped" &&
    records.length > 0 &&
    keyResult.writable &&
    keyResult.issues.length === 0 &&
    keyResult.keys.length === records.length;

  return {
    status,
    records,
    keys: keyResult.keys,
    ...(total !== undefined ? { total } : {}),
    issues,
    truncated,
    writable,
  };
}
