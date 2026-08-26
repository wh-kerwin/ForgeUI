import { DataTable } from "./DataTable";
import type { BatchAction, ColumnMeta, PageView } from "../../types/domain";

export function DataTableView({ columns, rows, columnMeta, defaultSort, batchActions, selectedRows, onSelectionChange, onBatchAction, onSortChange, onView, onEdit, onDelete }: { columns: string[]; rows: string[][]; columnMeta?: ColumnMeta[]; defaultSort?: Extract<PageView, { type: "list" }>["defaultSort"]; batchActions?: BatchAction[]; selectedRows?: Set<number>; onSelectionChange?: (rows: Set<number>) => void; onBatchAction?: (action: BatchAction, rows: number[]) => void; onSortChange?: (sort: NonNullable<Extract<PageView, { type: "list" }>["defaultSort"]>) => void; onView: (row: string[]) => void; onEdit: (row: string[]) => void; onDelete?: (row: string[]) => void }) {
  return <DataTable columns={columns} rows={rows} columnMeta={columnMeta} defaultSort={defaultSort} batchActions={batchActions} selectedRows={selectedRows} onSelectionChange={onSelectionChange} onBatchAction={onBatchAction} onSortChange={onSortChange} onView={onView} onEdit={onEdit} onDelete={onDelete} />;
}
