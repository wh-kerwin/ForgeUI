import type { ColumnMeta } from "../../types/domain";

export function formatColumnValue(value: string, meta?: ColumnMeta): string {
  if (!meta) return value;
  if (meta.enumLabels?.[value] !== undefined) return meta.enumLabels[value];
  if (meta.type === "money") {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currencyForFormat(meta.format),
          minimumFractionDigits: 2,
        }).format(number)
      : value;
  }
  if (meta.type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : value;
  }
  if ((meta.type === "date" || meta.type === "datetime") && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime()))
      return meta.type === "date" ? date.toLocaleDateString() : date.toLocaleString();
  }
  if (meta.type === "boolean") return value === "true" ? "是" : value === "false" ? "否" : value;
  return value;
}

function currencyForFormat(format?: string) {
  if (format?.includes("$")) return "USD";
  if (format?.includes("€")) return "EUR";
  if (format?.includes("£")) return "GBP";
  return "CNY";
}
