import { invoke } from "@tauri-apps/api/core";
import type { ExportDataset } from "../../features/pages/contracts/pageProjections";

/** Data export uses the bounded display dataset, never the page definition. */
export async function downloadXlsx(dataset: ExportDataset) {
  const bytes = await invoke<number[]>("export_xlsx", { dataset });
  const objectUrl = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${dataset.title || "数据导出"}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
