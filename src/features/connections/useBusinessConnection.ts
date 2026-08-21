import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadBusinessConnection } from "../../lib/tauri/storage";
import type { BusinessAuth, OpenApiSummary } from "../../types/domain";

const defaultAuth: BusinessAuth = { type: "none", secretRef: "business-default", apiKeyName: "x-api-key", caPem: "", apiBaseUrl: "", authorizedOperations: [] };

export function useBusinessConnection(onNotice: (message: string) => void) {
  const [spec, setSpec] = useState<OpenApiSummary | null>(null);
  const [auth, setAuth] = useState<BusinessAuth>(defaultAuth);
  const [secret, setSecret] = useState("");

  useEffect(() => { loadBusinessConnection().then((value) => value && setAuth(value)).catch(() => undefined); }, []);

  async function importSwaggerUrl() {
    const url = window.prompt("输入 Swagger/OpenAPI URL");
    if (!url) return;
    onNotice("正在获取 OpenAPI 文档…");
    try {
      const candidates = await invoke<string[]>("discover_openapi_candidates", { url });
      const selectedIndexText = candidates.length < 2 ? "1" : window.prompt(`发现 ${candidates.length} 个 Swagger/OpenAPI 规范，请输入要导入的编号：\n${candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n")}`, "1");
      if (!selectedIndexText) return;
      const selectedUrl = candidates[Number(selectedIndexText) - 1];
      if (!selectedUrl) return onNotice("选择的 OpenAPI 规范编号无效");
      const imported = await invoke<OpenApiSummary>("import_openapi_url", { url: selectedUrl });
      setSpec(imported);
      setAuth((current) => ({ ...current, apiBaseUrl: imported.api_base_url }));
      onNotice(`已导入 ${imported.title}，发现 ${imported.operation_count} 个接口`);
    } catch (error) { onNotice(String(error)); }
  }

  async function importOpenApiFile(file: File) {
    try {
      const content = await file.text();
      const imported = await invoke<OpenApiSummary>("parse_openapi_file", { content });
      setSpec(imported);
      setAuth((current) => ({ ...current, apiBaseUrl: imported.api_base_url === "local-file" ? current.apiBaseUrl || "" : imported.api_base_url }));
      onNotice(`已从本地文件导入 ${imported.title}，发现 ${imported.operation_count} 个接口`);
    } catch (error) { onNotice(String(error)); }
  }

  async function saveAuth() {
    try {
      if (auth.type !== "none" && secret) {
        await invoke("save_secret", { secret_ref: auth.secretRef, value: secret });
      } else if (auth.type === "none") {
        // Switching to no-auth must not leave the previous credential in the keychain.
        await invoke("delete_secret", { secret_ref: auth.secretRef }).catch(() => undefined);
      }
      setSecret("");
      await invoke("save_business_connection", { payload: JSON.stringify({ ...auth, apiBaseUrl: auth.apiBaseUrl || spec?.api_base_url || "", authorizedOperations: auth.authorizedOperations || [] }) });
      onNotice("业务 API 凭证已保存到系统钥匙串");
    } catch (error) { onNotice(String(error)); }
  }

  return { spec, setSpec, auth, setAuth, secret, setSecret, importSwaggerUrl, importOpenApiFile, saveAuth };
}
