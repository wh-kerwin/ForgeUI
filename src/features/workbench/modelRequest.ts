import type { ModelConfig, OpenApiSummary, PageSpec } from "../../types/domain";
import { buildOpenApiContext, toAllowedOperations } from "../connections/openApiOperations";
import { toModelSafePageSpec } from "../pages/modelSafePageSpec";

export function buildModelRequest(model: ModelConfig, prompt: string, spec: OpenApiSummary | null, template?: PageSpec) {
  const templateContext = template
    ? `\nUse this saved PageSpec as a structural starting point. Preserve useful layout choices and adapt its operations to the request. Saved template (safe structure only): ${JSON.stringify(toModelSafePageSpec(template))}`
    : "";
  return {
    prompt: `${prompt}${templateContext}`,
    base_url: model.baseUrl,
    protocol: model.protocol,
    model: model.model,
    secret_ref: model.secretRef,
    api_key: model.apiKey || null,
    openapi_context: buildOpenApiContext(spec),
    allowed_operations: toAllowedOperations(spec),
    custom_headers: model.customHeaders,
    custom_header_secret_refs: model.customHeaderSecretRefs,
    timeout_seconds: model.timeoutSeconds,
    temperature: model.temperature,
    max_tokens: model.maxTokens,
    structured_output: model.structuredOutput,
    streaming: model.streaming,
  };
}
