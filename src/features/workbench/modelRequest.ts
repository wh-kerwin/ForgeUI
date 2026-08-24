import type { ModelConfig, OpenApiSummary, PageSpec } from "../../types/domain";
import { buildOpenApiContext, toAllowedOperations } from "../connections/openApiOperations";
import { toModelSafePageSpec } from "../pages/modelSafePageSpec";

export function buildModelRequest(model: ModelConfig, prompt: string, spec: OpenApiSummary | null, template?: PageSpec) {
  const templateContext = template
    ? `\nUse this existing PageSpec as the only structural starting point. Preserve all existing operation bindings exactly; never invent, remove, or change operation_id, method, or path. If the request asks for an operation that is not already bound, implement the interaction as a local UI state/modal and do not add an operation. Existing PageSpec (safe structure only): ${JSON.stringify(toModelSafePageSpec(template))}`
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
