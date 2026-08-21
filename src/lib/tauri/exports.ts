import { invoke } from "@tauri-apps/api/core";
import type { PageSpec } from "../../types/domain";

export async function downloadXlsx(page: PageSpec) {
  const bytes = await invoke<number[]>("export_xlsx", { page });
  const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = window.document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${page.title || "数据导出"}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
