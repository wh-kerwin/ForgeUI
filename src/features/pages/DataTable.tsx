import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { BatchAction, ColumnMeta, PageSpec, PageView } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { formatColumnValue } from "./columnFormatting";

type Sort = NonNullable<Extract<PageView, { type: "list" }>["defaultSort"]>;
type Props = Pick<PageSpec, "columns" | "rows"> & { columnMeta?: ColumnMeta[]; defaultSort?: Sort; batchActions?: BatchAction[]; selectedRows?: Set<number>; onSelectionChange?: (rows: Set<number>) => void; onBatchAction?: (action: BatchAction, rows: number[]) => void; onSortChange?: (sort: Sort) => void; onView?: (row: string[], rowIndex: number) => void; onEdit?: (row: string[], rowIndex: number) => void; onDelete?: (row: string[], rowIndex: number) => void };

export function DataTable({ columns, rows, columnMeta = [], defaultSort, batchActions = [], selectedRows = new Set(), onSelectionChange, onBatchAction, onSortChange, onView, onEdit, onDelete }: Props) {
  const { language } = useLanguage();
  const hasActions = Boolean(onView || onEdit || onDelete);
  const hasSelection = Boolean(onSelectionChange && batchActions.length);
  // Models sometimes include a display-only "操作/Actions" column containing
  // labels such as 编辑. The renderer owns the real action column, so hide the
  // duplicate while keeping the original PageSpec columns for API payloads.
  const visibleColumns = useMemo(() => columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !/^(操作|动作|actions?|operations?)$/i.test(column.trim())), [columns]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(new Set());
  const [columnOrder, setColumnOrder] = useState<number[]>(() => visibleColumns.map(({ index }) => index));
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);
  const orderedColumns = useMemo(() => columnOrder.map((index) => visibleColumns.find((item) => item.index === index)).filter(Boolean) as typeof visibleColumns, [columnOrder, visibleColumns]);
  const displayedColumns = orderedColumns.filter(({ index }) => !hiddenColumns.has(index));
  const rowHeight = 36;
  const rowEntries = useMemo(() => {
    const entries = rows.map((row, originalIndex) => ({ row, originalIndex }));
    if (!sort) return entries;
    const columnIndex = columns.indexOf(sort.column);
    if (columnIndex < 0) return entries;
    const meta = columnMeta.find((item) => item.name === sort.column);
    const direction = sort.order === "asc" ? 1 : -1;
    return entries.sort((left, right) => compareValues(left.row[columnIndex] ?? "", right.row[columnIndex] ?? "", meta) * direction);
  }, [columnMeta, columns, rows, sort]);
  const virtual = rowEntries.length > 200;
  const viewportHeight = 520;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowHeight) - 5) : 0;
  const end = virtual ? Math.min(rowEntries.length, start + Math.ceil(viewportHeight / rowHeight) + 10) : rowEntries.length;
  const displayRows = rowEntries.slice(start, end);
  const moveColumn = (from: number, to: number) => setColumnOrder((current) => { const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  useEffect(() => {
    const indexes = visibleColumns.map(({ index }) => index);
    setColumnOrder((current) => [...current.filter((index) => indexes.includes(index)), ...indexes.filter((index) => !current.includes(index))]);
    setHiddenColumns((current) => new Set([
      ...[...current].filter((index) => indexes.includes(index)),
      ...visibleColumns.filter(({ column }) => columnMeta.find((meta) => meta.name === column)?.visible === false).map(({ index }) => index),
    ]));
  }, [columnMeta, visibleColumns]);
  useEffect(() => setSort(defaultSort ?? null), [defaultSort]);
  const toggleSort = (column: string) => {
    const next: Sort = sort?.column === column ? { column, order: sort.order === "asc" ? "desc" : "asc" } : { column, order: "asc" };
    setSort(next);
    onSortChange?.(next);
  };
  const toggleColumn = (index: number) => setHiddenColumns((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index);
    else if (displayedColumns.length > 1) next.add(index);
    return next;
  });
  const span = Math.max(1, displayedColumns.length + (hasActions ? 1 : 0) + (hasSelection ? 1 : 0));
  const toggleRow = (rowIndex: number) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedRows);
    if (next.has(rowIndex)) next.delete(rowIndex); else next.add(rowIndex);
    onSelectionChange(next);
  };
  const toggleAll = () => onSelectionChange?.(selectedRows.size === rows.length ? new Set() : new Set(rows.map((_, index) => index)));
  return <div className="table-config-wrap">
    {hasSelection && <div className="batch-toolbar"><span>{language === "zh" ? `已选 ${selectedRows.size} 条` : `${selectedRows.size} selected`}</span>{batchActions.map((action) => <button key={action.operation_id} type="button" className={action.method === "DELETE" ? "danger" : "secondary"} disabled={!selectedRows.size} onClick={() => onBatchAction?.(action, [...selectedRows])}>{action.operation_id}</button>)}</div>}
    <button type="button" className="secondary table-config-button" aria-expanded={showConfig} onClick={() => setShowConfig((value) => !value)}>{language === "zh" ? "配置列" : "Columns"}</button>
    {showConfig && <div className="column-config">{orderedColumns.map(({ column, index }, position) => <div className="column-config-item" key={`${column}-${index}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", String(position))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveColumn(Number(event.dataTransfer.getData("text/plain")), position)}>
      <label><input type="checkbox" checked={!hiddenColumns.has(index)} onChange={() => toggleColumn(index)} />{column}</label>
      <label className="column-width-control"><span>{language === "zh" ? "列宽" : "Width"}</span><input type="range" min="96" max="360" step="8" value={columnWidths[index] ?? 160} onChange={(event) => setColumnWidths((current) => ({ ...current, [index]: Number(event.target.value) }))} /></label>
    </div>)}</div>}
    <div className="table-wrap" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} style={virtual ? { maxHeight: viewportHeight, overflowY: "auto" } : undefined}>
      <table><thead><tr>{hasSelection && <th className="selection-cell"><input type="checkbox" aria-label={language === "zh" ? "全选" : "Select all"} checked={rows.length > 0 && selectedRows.size === rows.length} onChange={toggleAll} /></th>}{displayedColumns.map(({ column, index }) => { const meta = columnMeta.find((item) => item.name === column); const sortable = meta?.sortable === true; return <th key={`${column}-${index}`} aria-sort={sort?.column === column ? (sort.order === "asc" ? "ascending" : "descending") : undefined} style={{ width: meta?.width ?? columnWidths[index] ?? 160, minWidth: meta?.width ?? columnWidths[index] ?? 160 }}>{sortable ? <button type="button" className="table-sort" onClick={() => toggleSort(column)}><span>{column}</span>{sort?.column === column ? (sort.order === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ChevronsUpDown size={13} />}</button> : column}</th>; })}{hasActions && <th>{language === "zh" ? "操作" : "Actions"}</th>}</tr></thead><tbody>
        {virtual && start > 0 && <tr aria-hidden="true"><td colSpan={span} style={{ height: start * rowHeight, padding: 0 }} /></tr>}
        {displayRows.map(({ row, originalIndex }) => <tr key={originalIndex}>{hasSelection && <td className="selection-cell"><input type="checkbox" aria-label={`${language === "zh" ? "选择第" : "Select row "}${originalIndex + 1}`} checked={selectedRows.has(originalIndex)} onChange={() => toggleRow(originalIndex)} /></td>}{displayedColumns.map(({ column, index }) => { const cell = formatColumnValue(row[index] || "", columnMeta.find((meta) => meta.name === column)); return <td key={index} style={{ width: columnMeta.find((meta) => meta.name === column)?.width ?? columnWidths[index] ?? 160, minWidth: columnMeta.find((meta) => meta.name === column)?.width ?? columnWidths[index] ?? 160 }}>{index === 1 ? <span className="table-status">{cell}</span> : cell}</td>; })}{hasActions && <td className="table-actions">{onView && <button type="button" className="table-action" onClick={() => onView(row, originalIndex)}>{language === "zh" ? "查看" : "View"}</button>}{onEdit && <button type="button" className="table-action" onClick={() => onEdit(row, originalIndex)}>{language === "zh" ? "编辑" : "Edit"}</button>}{onDelete && <button type="button" className="table-action table-action-danger" onClick={() => onDelete(row, originalIndex)}>{language === "zh" ? "删除" : "Delete"}</button>}</td>}</tr>)}
        {virtual && end < rows.length && <tr aria-hidden="true"><td colSpan={span} style={{ height: (rows.length - end) * rowHeight, padding: 0 }} /></tr>}
      </tbody></table>
      {rows.length === 0 && <p className="muted">{language === "zh" ? "没有可显示的数据" : "No data to display"}</p>}
    </div>
  </div>;
}

function compareValues(left: string, right: string, meta?: ColumnMeta) {
  if (meta?.type === "number" || meta?.type === "money") {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  }
  if (meta?.type === "date" || meta?.type === "datetime") {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);
    if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) return leftDate - rightDate;
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}
