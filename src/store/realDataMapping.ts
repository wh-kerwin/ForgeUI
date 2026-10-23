import { withRecordIdFirst } from "../features/pages/recordIdentity";

const LIST_KEYS = ["data", "items", "results", "records", "content"] as const;

/** Maximum number of rows exposed to the generated page from a single API response. */
export const MAX_MAPPED_ROWS = 100;
/** Maximum number of columns exposed to the generated page from a single API response. */
export const MAX_MAPPED_COLUMNS = 50;

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

type MappedResponse = {
  status: "mapped";
  columns: string[];
  rows: string[][];
  total?: number;
  truncated?: boolean;
  truncatedRows?: boolean;
  truncatedColumns?: boolean;
};

export type RealDataMapping =
  MappedResponse | { status: "empty"; total: number } | { status: "invalid" };

export function mapRealDataResponse(body: unknown): RealDataMapping {
  const list = unwrapList(body);
  if (!list) return { status: "invalid" };
  if (list.length === 0) return { status: "empty", total: findTotal(body) ?? 0 };
  const rowsTruncated = list.length > MAX_MAPPED_ROWS;
  const records = list
    .slice(0, MAX_MAPPED_ROWS)
    .map((item) => (isRecord(item) ? item : { value: item }));
  const allColumns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const columns = withRecordIdFirst(allColumns.slice(0, MAX_MAPPED_COLUMNS));
  if (!columns.length) return { status: "invalid" };
  const total = findTotal(body);
  return {
    status: "mapped",
    columns,
    rows: records.map((record) => columns.map((column) => toCell(record[column]))),
    ...(total !== undefined ? { total } : {}),
    ...(rowsTruncated || allColumns.length > MAX_MAPPED_COLUMNS
      ? {
          truncated: true,
          truncatedRows: rowsTruncated,
          truncatedColumns: allColumns.length > MAX_MAPPED_COLUMNS,
        }
      : {}),
  };
}
