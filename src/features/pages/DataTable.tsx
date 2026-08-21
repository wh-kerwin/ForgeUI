import type { PageSpec } from "../../types/domain";

export function DataTable({
  columns,
  rows,
}: Pick<PageSpec, "columns" | "rows">) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td key={columnIndex}>
                  {columnIndex === 1 ? (
                    <span className="table-status">{cell}</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted">没有可显示的数据</p>}
    </div>
  );
}
