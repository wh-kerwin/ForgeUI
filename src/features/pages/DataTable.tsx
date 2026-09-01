import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import {
  Button,
  Checkbox,
  Popover,
  Space,
  Table,
  Tooltip,
  type TableColumnsType,
  type TableProps,
} from "antd";
import { Columns3, Eye, Pencil, Trash2 } from "lucide-react";
import type { BatchAction, ColumnMeta, PageSpec, PageView } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { formatColumnValue } from "./columnFormatting";

type Sort = NonNullable<Extract<PageView, { type: "list" }>["defaultSort"]>;
type Props = Pick<PageSpec, "columns" | "rows"> & {
  columnMeta?: ColumnMeta[];
  defaultSort?: Sort;
  batchActions?: BatchAction[];
  selectedRows?: Set<number>;
  onSelectionChange?: (rows: Set<number>) => void;
  onBatchAction?: (action: BatchAction, rows: number[]) => void;
  onSortChange?: (sort: Sort) => void;
  onView?: (row: string[], rowIndex: number) => void;
  onEdit?: (row: string[], rowIndex: number) => void;
  onDelete?: (row: string[], rowIndex: number) => void;
};

type TableRow = { key: number; row: string[]; rowIndex: number } & Record<
  string,
  string | number | string[]
>;

const EMPTY_COLUMN_META: ColumnMeta[] = [];
const EMPTY_BATCH_ACTIONS: BatchAction[] = [];
const EMPTY_SELECTED_ROWS = new Set<number>();

/**
 * Rows are rendered from a model-generated PageSpec, so column names are not
 * trusted input: they may repeat, contain dots (antd resolves a dotted
 * dataIndex as an object path) or shadow Object.prototype members. Records
 * therefore expose every cell under a generated, collision-free key and
 * `render` reads the raw row by index.
 */
const COLUMN_FIELD_PREFIX = "col_";
const columnField = (index: number) => `${COLUMN_FIELD_PREFIX}${index}`;

/** Rows above this count switch the table to virtual scrolling. */
const VIRTUAL_ROW_THRESHOLD = 200;
const VIRTUAL_VIEWPORT_HEIGHT = 520;

/** The generated layout renders the second column as a status pill. */
const STATUS_COLUMN_INDEX = 1;

/**
 * Sorting compares the raw cell value, not the formatted string: numbers must
 * order numerically ("20" before "100") and a locale-aware fallback keeps
 * mixed/alphanumeric data stable.
 */
export function compareCellValues(a: string | undefined, b: string | undefined): number {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left !== "" && right !== "" && !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, { numeric: true });
}

export function reconcileColumnOrder(current: number[], indexes: readonly number[]) {
  const next = [
    ...current.filter((index) => indexes.includes(index)),
    ...indexes.filter((index) => !current.includes(index)),
  ];
  return current.length === next.length &&
    current.every((index, position) => index === next[position])
    ? current
    : next;
}

export function reconcileHiddenColumns(
  current: Set<number>,
  indexes: readonly number[],
  defaultHiddenIndexes: readonly number[],
) {
  const next = new Set([...current].filter((index) => indexes.includes(index)));
  defaultHiddenIndexes.forEach((index) => next.add(index));
  return current.size === next.size && [...current].every((index) => next.has(index))
    ? current
    : next;
}

export function DataTable({
  columns,
  rows,
  columnMeta = EMPTY_COLUMN_META,
  defaultSort,
  batchActions = EMPTY_BATCH_ACTIONS,
  selectedRows = EMPTY_SELECTED_ROWS,
  onSelectionChange,
  onBatchAction,
  onSortChange,
  onView,
  onEdit,
  onDelete,
}: Props) {
  const { language } = useLanguage();
  const hasActions = Boolean(onView || onEdit || onDelete);
  const hasSelection = Boolean(onSelectionChange && batchActions.length);
  const visibleColumns = useMemo(
    () =>
      columns
        .map((column, index) => ({ column, index }))
        .filter(({ column }) => !/^(操作|动作|actions?|operations?)$/i.test(column.trim())),
    [columns],
  );
  const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(new Set());
  // Columns the user has explicitly toggled in the selector. Defaults from
  // `columnMeta` must not be re-applied to those, otherwise re-running the
  // effect below would silently undo a manual choice.
  const [userTouchedColumns, setUserTouchedColumns] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);

  // Lookup instead of a linear `find` per column per render.
  const columnMetaByName = useMemo(() => {
    const map = new Map<string, ColumnMeta>();
    columnMeta.forEach((meta) => map.set(meta.name, meta));
    return map;
  }, [columnMeta]);

  useEffect(() => {
    const indexes = visibleColumns.map(({ index }) => index);
    const defaultHidden = visibleColumns
      .filter(({ column }) => columnMetaByName.get(column)?.visible === false)
      .map(({ index }) => index)
      .filter((index) => !userTouchedColumns.has(index));
    setHiddenColumns((current) => reconcileHiddenColumns(current, indexes, defaultHidden));
  }, [columnMetaByName, userTouchedColumns, visibleColumns]);

  useEffect(() => setSort(defaultSort ?? null), [defaultSort]);

  const displayedColumns = useMemo(
    () => visibleColumns.filter(({ index }) => !hiddenColumns.has(index)),
    [hiddenColumns, visibleColumns],
  );
  const records = useMemo<TableRow[]>(
    () =>
      rows.map((row, rowIndex) => ({
        key: rowIndex,
        row,
        rowIndex,
        ...Object.fromEntries(
          columns.map((_column, index) => [columnField(index), row[index] ?? ""]),
        ),
      })),
    [columns, rows],
  );

  const tableColumns = useMemo<TableColumnsType<TableRow>>(() => {
    const result: TableColumnsType<TableRow> = displayedColumns.map(({ column, index }) => {
      const meta = columnMetaByName.get(column);
      const sortable = meta?.sortable === true;
      const sortOrder: "ascend" | "descend" | undefined =
        sort?.column === column ? (sort.order === "asc" ? "ascend" : "descend") : undefined;
      return {
        title: column,
        dataIndex: columnField(index),
        key: columnField(index),
        width: meta?.width ?? 160,
        ellipsis: true,
        sorter: sortable
          ? {
              compare: (a: TableRow, b: TableRow) => compareCellValues(a.row[index], b.row[index]),
            }
          : false,
        sortOrder,
        render: (_: unknown, record: TableRow) => {
          const value = formatColumnValue(record.row[index] ?? "", meta);
          return index === STATUS_COLUMN_INDEX ? (
            <span className="table-status">{value}</span>
          ) : (
            value
          );
        },
      };
    });
    if (hasActions) {
      result.push({
        title: language === "zh" ? "操作" : "Actions",
        key: "actions",
        fixed: "right",
        width: 116,
        render: (_: unknown, record: TableRow) => (
          <Space size={2} className="generated-table-actions">
            {onView && (
              <Tooltip title={language === "zh" ? "查看" : "View"}>
                <Button
                  type="text"
                  size="small"
                  icon={<Eye size={15} />}
                  aria-label={language === "zh" ? "查看" : "View"}
                  onClick={() => onView(record.row, record.rowIndex)}
                />
              </Tooltip>
            )}
            {onEdit && (
              <Tooltip title={language === "zh" ? "编辑" : "Edit"}>
                <Button
                  type="text"
                  size="small"
                  icon={<Pencil size={15} />}
                  aria-label={language === "zh" ? "编辑" : "Edit"}
                  onClick={() => onEdit(record.row, record.rowIndex)}
                />
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip title={language === "zh" ? "删除" : "Delete"}>
                <Button
                  danger
                  type="text"
                  size="small"
                  icon={<Trash2 size={15} />}
                  aria-label={language === "zh" ? "删除" : "Delete"}
                  onClick={() => onDelete(record.row, record.rowIndex)}
                />
              </Tooltip>
            )}
          </Space>
        ),
      });
    }
    return result;
  }, [columnMetaByName, displayedColumns, hasActions, language, onDelete, onEdit, onView, sort]);

  const handleTableChange = useCallback<NonNullable<TableProps<TableRow>["onChange"]>>(
    (_, __, nextSorter) => {
      const sorter = Array.isArray(nextSorter) ? nextSorter[0] : nextSorter;
      const field = typeof sorter?.columnKey === "string" ? sorter.columnKey : undefined;
      const order =
        sorter?.order === "ascend" ? "asc" : sorter?.order === "descend" ? "desc" : null;
      const index = field ? Number(field.slice(COLUMN_FIELD_PREFIX.length)) : NaN;
      const column = Number.isInteger(index) ? columns[index] : undefined;
      if (!column || !order) {
        setSort(null);
        return;
      }
      const next = { column, order } as Sort;
      setSort(next);
      onSortChange?.(next);
    },
    [columns, onSortChange],
  );

  // A selection can outlive the rows it refers to (a re-query returning fewer
  // rows, or a page switch), so prune stale indexes before they reach a batch
  // action — otherwise the action would target phantom rows.
  const validSelectedRows = useMemo(() => {
    const valid = new Set<number>();
    selectedRows.forEach((index) => {
      if (Number.isInteger(index) && index >= 0 && index < rows.length) valid.add(index);
    });
    return valid.size === selectedRows.size ? selectedRows : valid;
  }, [rows.length, selectedRows]);

  const selectedRowKeys = useMemo(() => [...validSelectedRows] as Key[], [validSelectedRows]);
  const rowSelection = useMemo(
    () =>
      hasSelection
        ? {
            selectedRowKeys,
            onChange: (keys: Key[]) => onSelectionChange?.(new Set(keys.map(Number))),
          }
        : undefined,
    [hasSelection, onSelectionChange, selectedRowKeys],
  );
  const virtual = rows.length > VIRTUAL_ROW_THRESHOLD;
  const scroll = useMemo<TableProps<TableRow>["scroll"]>(
    () => ({ x: "max-content", y: virtual ? VIRTUAL_VIEWPORT_HEIGHT : undefined }),
    [virtual],
  );
  const columnSelector = (
    <Checkbox.Group
      value={visibleColumns
        .filter(({ index }) => !hiddenColumns.has(index))
        .map(({ index }) => index)}
      onChange={(checked) => {
        const allowed = new Set(checked.map(Number));
        if (allowed.size === 0) return;
        // Once the user edits the selector their choice wins over the defaults.
        setUserTouchedColumns(new Set(visibleColumns.map(({ index }) => index)));
        setHiddenColumns(
          new Set(
            visibleColumns.filter(({ index }) => !allowed.has(index)).map(({ index }) => index),
          ),
        );
      }}
      options={visibleColumns.map(({ column, index }) => ({ label: column, value: index }))}
      className="generated-column-selector"
    />
  );

  return (
    <div className="generated-table-shell">
      <div className="generated-table-toolbar">
        {hasSelection && (
          <Space size={8} wrap className="batch-toolbar">
            <span>
              {language === "zh"
                ? `已选 ${validSelectedRows.size} 条`
                : `${validSelectedRows.size} selected`}
            </span>
            {batchActions.map((action) => (
              <Button
                key={action.operation_id}
                danger={action.method === "DELETE"}
                disabled={!validSelectedRows.size}
                onClick={() => onBatchAction?.(action, [...validSelectedRows])}
              >
                {action.operation_id}
              </Button>
            ))}
          </Space>
        )}
        <Popover content={columnSelector} trigger="click" placement="bottomRight">
          <Button icon={<Columns3 size={15} />}>{language === "zh" ? "配置列" : "Columns"}</Button>
        </Popover>
      </div>
      <Table<TableRow>
        className="generated-data-table"
        columns={tableColumns}
        dataSource={records}
        rowKey="key"
        rowSelection={rowSelection}
        pagination={false}
        size="middle"
        virtual={virtual}
        scroll={scroll}
        locale={{ emptyText: language === "zh" ? "没有可显示的数据" : "No data to display" }}
        onChange={handleTableChange}
      />
    </div>
  );
}
