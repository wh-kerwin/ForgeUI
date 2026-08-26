import { withRecordIdFirst } from "../features/pages/recordIdentity";

const LIST_KEYS = ["data", "items", "results", "records", "content"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapList(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value) || depth >= 3) return null;
  for (const key of LIST_KEYS) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const key of LIST_KEYS) {
    const nested = unwrapList(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function findTotal(value: unknown, depth = 0): number | undefined {
  if (!isRecord(value) || depth >= 3) return undefined;
  for (const key of ["total", "totalCount", "totalElements", "count"]) {
    const total = Number(value[key]);
    if (Number.isInteger(total) && total >= 0) return total;
  }
  for (const key of LIST_KEYS) {
    const nested = findTotal(value[key], depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function toCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

export function mapRealDataResponse(body: unknown): { columns: string[]; rows: string[][]; total?: number } | null {
  const list = unwrapList(body);
  if (!list?.length) return null;
  const records = list.slice(0, 100).map((item) => isRecord(item) ? item : { value: item });
  const columns = withRecordIdFirst([...new Set(records.flatMap((record) => Object.keys(record)))].slice(0, 50));
  if (!columns.length) return null;
  const total = findTotal(body);
  return {
    columns,
    rows: records.map((record) => columns.map((column) => toCell(record[column]))),
    ...(total !== undefined ? { total } : {}),
  };
}
