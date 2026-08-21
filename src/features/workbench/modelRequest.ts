import type { ModelConfig, OpenApiSummary } from "../../types/domain";
import { buildOpenApiContext, toAllowedOperations } from "../connections/openApiOperations";

export function buildModelRequest(model: ModelConfig, prompt: string, spec: OpenApiSummary | null) {
  return {
    prompt,
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
