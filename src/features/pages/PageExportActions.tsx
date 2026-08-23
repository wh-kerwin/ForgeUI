import { invoke } from "@tauri-apps/api/core";
import type { PageSpec } from "../../types/domain";
import { downloadXlsx } from "../../lib/tauri/exports";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { page: PageSpec; modelId?: string; templateId?: string; templateName?: string; onSaved: () => void };
function exportCsv(page: PageSpec) { const escape = (value: string) => `"${value.replace(/"/g, '""')}"`; const csv = [page.columns, ...page.rows].map((row) => row.map(escape).join(",")).join("\r\n"); const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `${page.title}.csv`; anchor.click(); URL.revokeObjectURL(url); }

export function PageExportActions({ page, modelId, templateId, templateName, onSaved }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  return <div className="page-actions"><button className="secondary" onClick={() => exportCsv(page)}>{zh ? "导出 CSV" : "Export CSV"}</button><button className="secondary" onClick={() => downloadXlsx(page).catch(() => alert(zh ? "请在桌面客户端中导出 XLSX" : "Export XLSX from the desktop client"))}>{zh ? "导出 XLSX" : "Export XLSX"}</button><button className="primary" onClick={() => invoke("save_template", { id: templateId || crypto.randomUUID(), name: templateName || page.title, payload: JSON.stringify(page), modelId: modelId || null }).then(() => { onSaved(); alert(zh ? "模板已保存" : "Template saved"); }).catch(() => alert(zh ? "请在桌面客户端中保存模板" : "Save templates from the desktop client"))}>{templateId ? (zh ? "更新当前模板" : "Update template") : (zh ? "保存为模板" : "Save as template")}</button></div>;
}
