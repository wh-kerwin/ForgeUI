import { useEffect, useId, useState } from "react";
import type { BatchAction, ColumnMeta, PageView } from "../../types/domain";
import { DataTableView } from "./DataTableView";
import { ChartPageView } from "./ChartPageView";
import { KanbanView } from "./KanbanView";

type Props = {
  view: PageView;
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: string[][];
  batchActions?: BatchAction[];
  selectedRows?: Set<number>;
  onSelectionChange?: (rows: Set<number>) => void;
  onBatchAction?: (action: BatchAction, rows: number[]) => void;
  onSortChange?: (sort: NonNullable<Extract<PageView, { type: "list" }>["defaultSort"]>) => void;
  onRowsChange: (rows: string[][]) => void;
  onView: (row: string[]) => void;
  onEdit: (row: string[]) => void;
  onDelete?: (row: string[]) => void;
};

export function PageViewRenderer({
  view,
  columns,
  columnMeta,
  rows,
  batchActions,
  selectedRows,
  onSelectionChange,
  onBatchAction,
  onSortChange,
  onRowsChange,
  onView,
  onEdit,
  onDelete,
}: Props) {
  if (view.type === "list")
    return (
      <DataTableView
        columns={columns}
        rows={rows}
        columnMeta={columnMeta}
        defaultSort={view.defaultSort}
        batchActions={batchActions}
        selectedRows={selectedRows}
        onSelectionChange={onSelectionChange}
        onBatchAction={onBatchAction}
        onSortChange={onSortChange}
        onView={onView}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
  if (view.type === "chart") return <ChartPageView view={view} columns={columns} rows={rows} />;
  if (view.type === "kanban")
    return <KanbanView view={view} columns={columns} rows={rows} onRowsChange={onRowsChange} />;
  if (view.type === "tabs")
    return (
      <TabbedPageView
        {...{
          view,
          columns,
          columnMeta,
          rows,
          batchActions,
          selectedRows,
          onSelectionChange,
          onBatchAction,
          onSortChange,
          onRowsChange,
          onView,
          onEdit,
          onDelete,
        }}
      />
    );
  const ratio = Math.min(0.8, Math.max(0.2, view.splitRatio ?? 0.5));
  return (
    <div
      className="split-view"
      style={{ gridTemplateColumns: `minmax(0, ${ratio}fr) minmax(0, ${1 - ratio}fr)` }}
    >
      <div>
        <PageViewRenderer
          {...{
            columns,
            columnMeta,
            rows,
            batchActions,
            selectedRows,
            onSelectionChange,
            onBatchAction,
            onSortChange,
            onRowsChange,
            onView,
            onEdit,
            onDelete,
          }}
          view={view.left}
        />
      </div>
      <div>
        <PageViewRenderer
          {...{
            columns,
            columnMeta,
            rows,
            batchActions,
            selectedRows,
            onSelectionChange,
            onBatchAction,
            onSortChange,
            onRowsChange,
            onView,
            onEdit,
            onDelete,
          }}
          view={view.right}
        />
      </div>
    </div>
  );
}

function TabbedPageView({
  view,
  ...props
}: Omit<Props, "view"> & { view: Extract<PageView, { type: "tabs" }> }) {
  const groupId = useId();
  const [activeKey, setActiveKey] = useState(view.items[0]?.key ?? "");
  useEffect(() => {
    if (!view.items.some((item) => item.key === activeKey)) setActiveKey(view.items[0]?.key ?? "");
  }, [activeKey, view.items]);
  const activeIndex = Math.max(
    0,
    view.items.findIndex((item) => item.key === activeKey),
  );
  const activeItem = view.items[activeIndex];
  if (!activeItem) return null;
  const move = (offset: number) => {
    const next = (activeIndex + offset + view.items.length) % view.items.length;
    setActiveKey(view.items[next].key);
  };
  return (
    <div className="nested-view-tabs">
      <div className="nested-view-tablist" role="tablist" aria-label="View tabs">
        {view.items.map((item, index) => (
          <button
            key={item.key}
            id={`${groupId}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={item.key === activeItem.key}
            aria-controls={`${groupId}-panel-${index}`}
            tabIndex={item.key === activeItem.key ? 0 : -1}
            className={item.key === activeItem.key ? "active" : ""}
            onClick={() => setActiveKey(item.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <section
        id={`${groupId}-panel-${activeIndex}`}
        role="tabpanel"
        aria-labelledby={`${groupId}-tab-${activeIndex}`}
        className="nested-view-panel"
      >
        <PageViewRenderer {...props} view={activeItem.view} />
      </section>
    </div>
  );
}
