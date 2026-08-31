import { useEffect, useMemo, useState, type Key } from "react";
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
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);

  useEffect(() => {
    const indexes = visibleColumns.map(({ index }) => index);
    const defaultHidden = visibleColumns
      .filter(({ column }) => columnMeta.find((meta) => meta.name === column)?.visible === false)
      .map(({ index }) => index);
    setHiddenColumns((current) => reconcileHiddenColumns(current, indexes, defaultHidden));
  }, [columnMeta, visibleColumns]);

  useEffect(() => setSort(defaultSort ?? null), [defaultSort]);

  const displayedColumns = visibleColumns.filter(({ index }) => !hiddenColumns.has(index));
  const records = useMemo<TableRow[]>(
    () =>
      rows.map((row, rowIndex) => ({
        key: rowIndex,
        row,
        rowIndex,
        ...Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""])),
      })),
    [columns, rows],
  );

  const tableColumns = useMemo<TableColumnsType<TableRow>>(() => {
    const result: TableColumnsType<TableRow> = displayedColumns.map(({ column, index }) => {
      const meta = columnMeta.find((item) => item.name === column);
      const sortable = meta?.sortable === true;
      const sortOrder: "ascend" | "descend" | undefined =
        sort?.column === column ? (sort.order === "asc" ? "ascend" : "descend") : undefined;
      return {
        title: column,
        dataIndex: column,
        key: column,
        width: meta?.width ?? 160,
        ellipsis: true,
        sorter: sortable,
        sortOrder,
        render: (_: unknown, record: TableRow) => {
          const value = formatColumnValue(record.row[index] ?? "", meta);
          return index === 1 ? <span className="table-status">{value}</span> : value;
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
  }, [columnMeta, displayedColumns, hasActions, language, onDelete, onEdit, onView, sort]);

  const handleTableChange: TableProps<TableRow>["onChange"] = (_, __, nextSorter) => {
    const sorter = Array.isArray(nextSorter) ? nextSorter[0] : nextSorter;
    const column = typeof sorter?.columnKey === "string" ? sorter.columnKey : undefined;
    const order = sorter?.order === "ascend" ? "asc" : sorter?.order === "descend" ? "desc" : null;
    if (!column || !order) {
      setSort(null);
      return;
    }
    const next = { column, order } as Sort;
    setSort(next);
    onSortChange?.(next);
  };

  const selectedRowKeys = [...selectedRows] as Key[];
  const rowSelection = hasSelection
    ? {
        selectedRowKeys,
        onChange: (keys: Key[]) => onSelectionChange?.(new Set(keys.map(Number))),
      }
    : undefined;
  const columnSelector = (
    <Checkbox.Group
      value={visibleColumns
        .filter(({ index }) => !hiddenColumns.has(index))
        .map(({ index }) => index)}
      onChange={(checked) => {
        const allowed = new Set(checked.map(Number));
        if (allowed.size === 0) return;
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
              {language === "zh" ? `已选 ${selectedRows.size} 条` : `${selectedRows.size} selected`}
            </span>
            {batchActions.map((action) => (
              <Button
                key={action.operation_id}
                danger={action.method === "DELETE"}
                disabled={!selectedRows.size}
                onClick={() => onBatchAction?.(action, [...selectedRows])}
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
        virtual={rows.length > 200}
        scroll={{ x: "max-content", y: rows.length > 200 ? 520 : undefined }}
        locale={{ emptyText: language === "zh" ? "没有可显示的数据" : "No data to display" }}
        onChange={handleTableChange}
      />
    </div>
  );
}
