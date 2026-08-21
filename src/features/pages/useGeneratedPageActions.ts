import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BusinessAuth, OpenApiSummary, PageSpec } from "../../types/domain";

type Options = { spec: OpenApiSummary | null; auth: BusinessAuth; onNotice: (message: string) => void; };

export function useGeneratedPageActions({ spec, auth, onNotice }: Options) {
  const [page, setPage] = useState<PageSpec | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [querying, setQuerying] = useState(false);
  const apiBaseUrl = auth.apiBaseUrl || spec?.api_base_url || "";

  const request = (url: string, method: string, operationKey: string, body?: unknown) => invoke<{ status: number; body: unknown }>("execute_api", { request: {
    url, method, body, headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    auth_type: auth.type, secret_ref: auth.type === "none" ? null : auth.secretRef, api_key_name: auth.apiKeyName,
    ca_pem: auth.caPem || null,
    operation_key: operationKey,
  }});

  async function query(filters: Record<string, string> = {}, operationKey?: string) {
    const operation = operationKey || spec?.operations.find((item) => item.startsWith("GET "));
    if (!spec || !operation) return onNotice("请先导入包含 GET 查询接口的 OpenAPI 文档");
    const path = operation.split(" · ")[0].replace(/^GET\s+/, "");
    const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value.trim())).toString();
    setQuerying(true);
    try {
      const response = await request(`${apiBaseUrl.replace(/\/$/, "")}${path}${queryString ? `?${queryString}` : ""}`, "GET", operation);
      const value = response.body as { data?: unknown[]; items?: unknown[]; results?: unknown[] };
      const list = Array.isArray(response.body) ? response.body : value.data || value.items || value.results || [];
      if (!Array.isArray(list) || !list.length) return onNotice("业务 API 返回空数据");
      const first = list[0] && typeof list[0] === "object" ? list[0] as Record<string, unknown> : { value: list[0] };
      const columns = Object.keys(first);
      const rows = list.slice(0, 100).map((item) => Object.values(typeof item === "object" && item ? item as Record<string, unknown> : { value: item }).map((value) => String(value ?? "")));
      setPage((current) => current ? { ...current, columns, rows } : current);
      onNotice(`已从真实业务 API 加载 ${rows.length} 条数据`);
    } catch (error) { onNotice(String(error)); } finally { setQuerying(false); }
  }

  async function loadDetail(path: string, id: string, operationKey: string) {
    if (!spec || !id.trim()) return onNotice("请输入详情记录 ID");
    try {
      const response = await request(`${apiBaseUrl.replace(/\/$/, "")}${path.replace(/\{[^}]+\}/, encodeURIComponent(id))}`, "GET", operationKey);
      setDetail(response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : { value: response.body });
      onNotice("详情加载成功");
    } catch (error) { onNotice(String(error)); }
  }

  async function mutate(method: string, path: string, text: string, operationKey: string) {
    if (!spec) return;
    let body: unknown;
    try { body = text.trim() ? JSON.parse(text) : undefined; } catch { return onNotice("请求体必须是合法 JSON"); }
    try { const response = await request(`${apiBaseUrl.replace(/\/$/, "")}${path}`, method, operationKey, body); onNotice(`操作成功（HTTP ${response.status}）`); } catch (error) { onNotice(String(error)); }
  }

  async function deleteRecord(path: string, id: string, operationKey: string) {
    if (!spec || !id.trim()) return onNotice("请输入要删除的记录 ID");
    if (!window.confirm("确定要删除这条记录吗？此操作不可撤销。")) return;
    try { const response = await request(`${apiBaseUrl.replace(/\/$/, "")}${path.replace(/\{[^}]+\}/, encodeURIComponent(id))}`, "DELETE", operationKey); onNotice(`删除成功（HTTP ${response.status}）`); } catch (error) { onNotice(String(error)); }
  }

  return { page, setPage, detail, querying, query, loadDetail, mutate, deleteRecord };
}
