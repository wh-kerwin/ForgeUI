import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MODELS } from "../../constants/models";
import {
  deleteModelConfig,
  deleteSecret,
  isTauri,
  loadDefaultModel,
  loadSecret,
  loadModelMetadata,
  saveModelMetadata,
  saveSecret,
  setDefaultModel,
} from "../../lib/tauri/storage";
import type { ModelConfig } from "../../types/domain";

const BROWSER_STORAGE_KEY = "forge-models";

function normalizeModel(model: Partial<ModelConfig>): ModelConfig {
  return {
    id: model.id || crypto.randomUUID(),
    name: model.name || "Unnamed model",
    protocol: model.protocol === "anthropic" ? "anthropic" : "openai",
    baseUrl: model.baseUrl || "",
    model: model.model || "",
    apiKey: model.apiKey || "",
    secretRef: model.secretRef,
    temperature: model.temperature ?? 0.2,
    maxTokens: model.maxTokens ?? 4096,
    streaming: model.streaming ?? true,
    enabled: model.enabled ?? true,
    timeoutSeconds: model.timeoutSeconds ?? 60,
    structuredOutput: model.structuredOutput || "jsonObject",
    customHeaders: model.customHeaders || {},
    customHeaderSecretRefs: model.customHeaderSecretRefs,
    promptTemplateId: model.promptTemplateId,
    notes: model.notes || "",
  };
}

function loadBrowserModels(): ModelConfig[] {
  try {
    const stored = JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY) || "null");
    const source = Array.isArray(stored) && stored.length ? stored : DEFAULT_MODELS;
    return source.map(normalizeModel);
  } catch {
    return DEFAULT_MODELS.map(normalizeModel);
  }
}

export function useModelConfigurations() {
  const [models, setModels] = useState<ModelConfig[]>(loadBrowserModels);
  const [selectedId, setSelectedId] = useState("default");

  const activeModel = useMemo(
    () => models.find((model) => model.id === selectedId) || models[0],
    [models, selectedId],
  );

  useEffect(() => {
    if (!isTauri()) {
      localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(models));
      return;
    }
    models.forEach((model) => saveModelMetadata(model).catch(() => undefined));
  }, [models]);

  useEffect(() => {
    if (!isTauri()) return;
    Promise.all([loadModelMetadata(), loadDefaultModel()])
      .then(([loaded, defaultId]) => {
        if (loaded.length) {
          const normalized = loaded.map(normalizeModel);
          setModels(normalized);
          setSelectedId(
            defaultId && normalized.some((model) => model.id === defaultId)
              ? defaultId
              : normalized[0].id,
          );
        }
      })
      .catch(() => undefined);
  }, []);

  async function saveModel(model: ModelConfig) {
    const previous = models.find((item) => item.id === model.id);
    const secretRef = model.secretRef || `model-${model.id}`;
    if (model.apiKey) {
      await saveSecret(secretRef, model.apiKey);
      const saved = await loadSecret(secretRef);
      if (saved !== model.apiKey) throw new Error("模型 API Key 未能写入系统钥匙串");
    }
    const customHeaderSecretRefs: Record<string, string> = {};
    if (isTauri()) {
      for (const [name, value] of Object.entries(model.customHeaders || {})) {
        const headerRef =
          model.customHeaderSecretRefs?.[name] ||
          `model-${model.id}-header-${btoa(name).replace(/[^a-zA-Z0-9]/g, "")}`;
        customHeaderSecretRefs[name] = headerRef;
        if (value) await saveSecret(headerRef, value);
      }
      const nextRefs = new Set(Object.values(customHeaderSecretRefs));
      for (const oldRef of Object.values(previous?.customHeaderSecretRefs || {})) {
        if (!nextRefs.has(oldRef)) await deleteSecret(oldRef).catch(() => undefined);
      }
    }
    const safeModel = {
      ...model,
      secretRef,
      apiKey: "",
      customHeaders: Object.fromEntries(
        Object.keys(model.customHeaders || {}).map((name) => [name, ""]),
      ),
      customHeaderSecretRefs,
    };
    if (isTauri()) await saveModelMetadata(safeModel);
    setModels((current) =>
      current.some((item) => item.id === model.id)
        ? current.map((item) => (item.id === model.id ? safeModel : item))
        : [...current, safeModel],
    );
    setSelectedId(model.id);
  }

  async function makeDefault(id: string) {
    if (isTauri()) await setDefaultModel(id);
    setSelectedId(id);
  }

  async function removeModel(id: string) {
    if (models.length < 2) throw new Error("至少保留一个模型配置");
    const target = models.find((model) => model.id === id);
    if (isTauri()) {
      await deleteModelConfig(id);
      if (target?.secretRef)
        await deleteSecret(target.secretRef).catch(() => undefined);
      for (const secretRef of Object.values(
        target?.customHeaderSecretRefs || {},
      ))
        await deleteSecret(secretRef).catch(() => undefined);
    }
    setModels((current) => current.filter((model) => model.id !== id));
    if (selectedId === id)
      setSelectedId(models.find((model) => model.id !== id)?.id || "");
  }

  return {
    models,
    activeModel,
    selectedId,
    setSelectedId,
    saveModel,
    makeDefault,
    removeModel,
  };
}
