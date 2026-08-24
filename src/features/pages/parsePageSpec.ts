import type { PageSpec } from "../../types/domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePageSpec(value: unknown): PageSpec | null {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.description !== "string") return null;
  if (!Array.isArray(value.filters) || !value.filters.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(value.columns) || !value.columns.every((item) => typeof item === "string")) return null;
  const columns = value.columns;
  if (!Array.isArray(value.rows) || !value.rows.every((row) => Array.isArray(row) && row.every((item) => typeof item === "string"))) return null;
  // Older model responses and templates can contain short/long rows. Keep the
  // page usable at the client boundary by applying the same bounded repair as
  // the Rust validator: truncate extra cells and fill missing cells.
  const rows = value.rows.map((row) => row.slice(0, columns.length).concat(Array(Math.max(0, columns.length - row.length)).fill("")));
  if (!Array.isArray(value.stats) || !value.stats.every((stat) => isRecord(stat) && typeof stat.label === "string" && typeof stat.value === "string")) return null;
  if (value.operations !== undefined && (!Array.isArray(value.operations) || !value.operations.every((operation) => isRecord(operation) && typeof operation.operation_id === "string" && typeof operation.method === "string" && typeof operation.path === "string" && typeof operation.role === "string"))) return null;
  return { ...value, columns, rows } as unknown as PageSpec;
}

export function parsePageSpecJson(payload: string): PageSpec | null {
  try { return parsePageSpec(JSON.parse(payload)); } catch { return null; }
}
