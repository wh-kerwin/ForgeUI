import { invoke } from "@tauri-apps/api/core";
import type { PageSpec } from "../../types/domain";
import { downloadXlsx } from "../../lib/tauri/exports";
import { toUserMessage } from "../../lib/errors";
import { useLanguage } from "../../i18n/LanguageProvider";
import {
  csvSafe,
  forTemplate,
  toExportDataset,
  type ExportDataset,
} from "./contracts/pageProjections";
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
  /** Where the displayed values came from; never implied by row count. */
  dataScope?: ExportDataset["scope"];
};
function exportCsv(dataset: ExportDataset) {
  const cell = (value: string) => `"${csvSafe(value).replace(/"/g, '""')}"`;
  const csv = [dataset.columns, ...dataset.rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${dataset.title}.csv`;
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
  dataScope = "current-page",
}: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  // Data exports carry only loaded display values; template saves use a pure structural projection.
  const dataset = toExportDataset({
    title: page.title,
    columns: displayColumns ?? page.columns,
    rows: displayRows ?? [],
    scope: dataScope,
    zh,
  });
  return (
    <Space className="page-actions" wrap>
      <Button icon={<Download size={15} />} onClick={() => exportCsv(dataset)}>
        {zh ? "导出 CSV" : "Export CSV"}
      </Button>
      <Button
        icon={<Download size={15} />}
        onClick={() =>
          downloadXlsx(dataset).catch(() =>
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
            payload: JSON.stringify(forTemplate(page)),
            modelId: modelId || null,
            apiDocumentIds,
          })
            .then(() => {
              onSaved();
              alert(zh ? "模板已保存（仅页面结构）" : "Template saved (structure only)");
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
