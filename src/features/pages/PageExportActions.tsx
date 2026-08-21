import { invoke } from "@tauri-apps/api/core";
import type { PageSpec } from "../../types/domain";
import { downloadXlsx } from "../../lib/tauri/exports";

type Props = { page: PageSpec; modelId?: string; onSaved: () => void };

function exportCsv(page: PageSpec) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = [page.columns, ...page.rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${page.title}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PageExportActions({ page, modelId, onSaved }: Props) {
  return (
    <div className="page-actions">
      <button className="secondary" onClick={() => exportCsv(page)}>
        导出 CSV
      </button>
      <button
        className="secondary"
        onClick={() =>
          downloadXlsx(page).catch(() => alert("请在桌面客户端中导出 XLSX"))
        }
      >
        导出 XLSX
      </button>
      <button
        className="primary"
        onClick={() =>
          invoke("save_template", {
            id: crypto.randomUUID(),
            name: page.title,
            payload: JSON.stringify(page),
            modelId: modelId || null,
          })
            .then(() => {
              onSaved();
              alert("模板已保存");
            })
            .catch(() => alert("请在桌面客户端中保存模板"))
        }
      >
        保存为模板
      </button>
    </div>
  );
}
