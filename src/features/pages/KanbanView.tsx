import type { PageView } from "../../types/domain";

export function KanbanView({ view, columns, rows, onRowsChange }: { view: Extract<PageView, { type: "kanban" }>; columns: string[]; rows: string[][]; onRowsChange: (rows: string[][]) => void }) {
  const groupIndex = columns.indexOf(view.groupColumn);
  const fields = view.cardFields.map((field) => ({ field, index: columns.indexOf(field) })).filter(({ index }) => index >= 0);
  const groups = new Map<string, { row: string[]; rowIndex: number }[]>();
  rows.forEach((row, rowIndex) => { const key = row[groupIndex] || "未分组"; groups.set(key, [...(groups.get(key) ?? []), { row, rowIndex }]); });
  if (groupIndex < 0) return <div className="empty-view">找不到看板分组列：{view.groupColumn}</div>;
  const moveCard = (rowIndex: number, group: string) => {
    const next = rows.map((row, index) => index === rowIndex ? row.map((cell, columnIndex) => columnIndex === groupIndex ? group : cell) : row);
    onRowsChange(next);
  };
  return <div className="kanban-view"><h4>{view.title}</h4><div className="kanban-columns">{[...groups].map(([group, groupRows]) => <section key={group} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveCard(Number(event.dataTransfer.getData("text/row-index")), group)}><h5>{group}<span>{groupRows.length}</span></h5>{groupRows.map(({ row, rowIndex }) => <article key={rowIndex} draggable onDragStart={(event) => event.dataTransfer.setData("text/row-index", String(rowIndex))}>{fields.map(({ field, index: fieldIndex }) => <div key={field}><small>{field}</small><strong>{row[fieldIndex] ?? ""}</strong></div>)}</article>)}</section>)}</div></div>;
}
