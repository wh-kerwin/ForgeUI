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

export function mapRealDataResponse(body: unknown): { columns: string[]; rows: string[][] } | null {
  const list = unwrapList(body);
  if (!list?.length) return null;
  const records = list.slice(0, 100).map((item) => isRecord(item) ? item : { value: item });
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))].slice(0, 50);
  if (!columns.length) return null;
  return {
    columns,
    rows: records.map((record) => columns.map((column) => toCell(record[column]))),
  };
}
