import type { PageSpec } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = Pick<PageSpec, "columns" | "rows"> & { onView?: (row: string[], rowIndex: number) => void; onEdit?: (row: string[], rowIndex: number) => void; onDelete?: (row: string[], rowIndex: number) => void };

export function DataTable({ columns, rows, onView, onEdit, onDelete }: Props) {
  const { language } = useLanguage();
  const hasActions = Boolean(onView || onEdit || onDelete);
  // Models sometimes include a display-only "操作/Actions" column containing
  // labels such as 编辑. The renderer owns the real action column, so hide the
  // duplicate while keeping the original PageSpec columns for API payloads.
  const actionColumnIndexes = new Set(columns.map((column, index) => /^(操作|动作|actions?|operations?)$/i.test(column.trim()) ? index : -1).filter((index) => index >= 0));
  const visibleColumns = columns.map((column, index) => ({ column, index })).filter(({ index }) => !actionColumnIndexes.has(index));
  return <div className="table-wrap"><table><thead><tr>{visibleColumns.map(({ column, index }) => <th key={`${column}-${index}`}>{column}</th>)}{hasActions && <th>{language === "zh" ? "操作" : "Actions"}</th>}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{visibleColumns.map(({ index }) => { const cell = row[index] || ""; return <td key={index}>{index === 1 ? <span className="table-status">{cell}</span> : cell}</td>; })}{hasActions && <td className="table-actions">{onView && <button type="button" className="table-action" onClick={() => onView(row, rowIndex)}>{language === "zh" ? "查看" : "View"}</button>}{onEdit && <button type="button" className="table-action" onClick={() => onEdit(row, rowIndex)}>{language === "zh" ? "编辑" : "Edit"}</button>}{onDelete && <button type="button" className="table-action table-action-danger" onClick={() => onDelete(row, rowIndex)}>{language === "zh" ? "删除" : "Delete"}</button>}</td>}</tr>)}</tbody></table>{rows.length === 0 && <p className="muted">{language === "zh" ? "没有可显示的数据" : "No data to display"}</p>}</div>;
}
