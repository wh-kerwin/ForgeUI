import { invoke } from "@tauri-apps/api/core";
import type { PageSpec } from "../../types/domain";
import { downloadXlsx } from "../../lib/tauri/exports";
import { toUserMessage } from "../../lib/errors";
import { useLanguage } from "../../i18n/LanguageProvider";
import { Button, Space } from "antd";
import { Download, Save } from "lucide-react";

type Props = {
  page: PageSpec;
  projectId: string;
  apiDocumentIds: string[];
  modelId?: string;
  templateId?: string;
  templateName?: string;
  onSaved: () => void;
  /** Loaded display data. C3 never reads business rows from the definition. */
  displayColumns?: string[];
  displayRows?: string[][];
};
function exportCsv(columns: string[], rows: string[][], title: string) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = [columns, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${title}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PageExportActions({
  page,
  projectId,
  apiDocumentIds,
  modelId,
  templateId,
  templateName,
  onSaved,
  displayColumns,
  displayRows,
}: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  // Data exports use loaded display values; template saves use the pure definition.
  const exportView: PageSpec = {
    ...page,
    columns: displayColumns ?? page.columns,
    rows: displayRows ?? page.rows,
  };
  return (
    <Space className="page-actions" wrap>
      <Button
        icon={<Download size={15} />}
        onClick={() => exportCsv(exportView.columns, exportView.rows, page.title)}
      >
        {zh ? "导出 CSV" : "Export CSV"}
      </Button>
      <Button
        icon={<Download size={15} />}
        onClick={() =>
          downloadXlsx(exportView).catch(() =>
            alert(zh ? "请在桌面客户端中导出 XLSX" : "Export XLSX from the desktop client"),
          )
        }
      >
        {zh ? "导出 XLSX" : "Export XLSX"}
      </Button>
      <Button
        icon={<Save size={15} />}
        onClick={() =>
          invoke("save_template", {
            id: templateId || crypto.randomUUID(),
            projectId,
            name: templateName || page.title,
            payload: JSON.stringify(page),
            modelId: modelId || null,
            apiDocumentIds,
          })
            .then(() => {
              onSaved();
              alert(zh ? "模板已保存" : "Template saved");
            })
            .catch((error) => alert(toUserMessage(error)))
        }
      >
        {templateId
          ? zh
            ? "更新当前模板"
            : "Update template"
          : zh
            ? "保存为模板"
            : "Save as template"}
      </Button>
    </Space>
  );
}
