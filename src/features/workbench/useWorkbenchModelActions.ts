import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModelConfig } from "../../types/domain";

type Props = {
  active?: ModelConfig;
  saveModel: (model: ModelConfig) => Promise<void>;
  makeDefault: (id: string) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  onSaved: () => void;
  onNotice: (message: string) => void;
};

export function useWorkbenchModelActions({ active, saveModel, makeDefault, removeModel, onSaved, onNotice }: Props) {
  const [testing, setTesting] = useState(false);

  async function save(config: ModelConfig) {
    try { await saveModel(config); onSaved(); onNotice("模型配置已保存，密钥已交给系统钥匙串"); }
    catch (error) { onNotice(String(error)); }
  }

  async function duplicate() {
    if (!active) return;
    try {
      await saveModel({ ...active, id: crypto.randomUUID(), name: `${active.name}（副本）`, secretRef: undefined, apiKey: "" });
      onNotice("已复制模型配置；如需使用密钥，请为副本重新填写 API Key");
    } catch (error) { onNotice(String(error)); }
  }

  async function setDefault() {
    if (!active) return;
    try { await makeDefault(active.id); onNotice(`已将「${active.name}」设为默认模型`); }
    catch (error) { onNotice(String(error)); }
  }

  async function remove() {
    if (!active || !window.confirm(`删除模型配置「${active.name}」？该操作不会删除其他配置。`)) return;
    try { await removeModel(active.id); onNotice("模型配置已删除"); }
    catch (error) { onNotice(String(error)); }
  }

  async function test(config: ModelConfig) {
    setTesting(true);
    try {
      const result = await invoke<{ message: string; protocol: string; model: string; response_time_ms: number; status: number }>("validate_model_config", { input: { base_url: config.baseUrl, protocol: config.protocol, model: config.model, api_key: config.apiKey || null, secret_ref: config.secretRef || null, custom_headers: config.customHeaders, custom_header_secret_refs: config.customHeaderSecretRefs, timeout_seconds: config.timeoutSeconds } });
      onNotice(`${result.message} · ${result.protocol} · ${result.response_time_ms}ms · HTTP ${result.status}`);
    } catch (error) { onNotice(String(error)); } finally { setTesting(false); }
  }

  return { testing, save, duplicate, setDefault, remove, test };
}
