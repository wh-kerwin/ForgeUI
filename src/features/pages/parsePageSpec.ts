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
  const rows = value.rows;
  if (!Array.isArray(value.stats) || !value.stats.every((stat) => isRecord(stat) && typeof stat.label === "string" && typeof stat.value === "string")) return null;
  if (rows.some((row) => row.length !== columns.length)) return null;
  if (value.operations !== undefined && (!Array.isArray(value.operations) || !value.operations.every((operation) => isRecord(operation) && typeof operation.operation_id === "string" && typeof operation.method === "string" && typeof operation.path === "string" && typeof operation.role === "string"))) return null;
  return value as unknown as PageSpec;
}

export function parsePageSpecJson(payload: string): PageSpec | null {
  try { return parsePageSpec(JSON.parse(payload)); } catch { return null; }
}
