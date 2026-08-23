import type { ModelConfig } from "../../types/domain";

export function isModelConfigured(model?: ModelConfig): boolean {
  if (!model || !model.enabled) return false;
  return Boolean(model.baseUrl.trim() && model.model.trim() && (model.apiKey.trim() || model.secretRef));
}
