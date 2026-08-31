const EXACT_ID_COLUMNS = ["id", "_id", "uuid", "guid"];

export function recordIdColumn(columns: readonly string[]) {
  const exact = EXACT_ID_COLUMNS.map((name) =>
    columns.findIndex((column) => column.toLocaleLowerCase() === name),
  ).find((index) => index >= 0);
  if (exact !== undefined) return exact;

  const suffixed = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => /(?:_|-)id$|id$/i.test(column));
  return suffixed.length === 1 ? suffixed[0].index : undefined;
}

export function recordId(columns: readonly string[], row: readonly string[]) {
  const index = recordIdColumn(columns);
  return index === undefined ? "" : (row[index]?.trim() ?? "");
}

export function withRecordIdFirst(columns: string[]) {
  const index = recordIdColumn(columns);
  if (index === undefined || index === 0) return columns;
  return [columns[index], ...columns.slice(0, index), ...columns.slice(index + 1)];
}
