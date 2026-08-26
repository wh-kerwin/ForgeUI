import type { ModelConfig, OpenApiSummary, PageSpec, PromptTemplate } from "../../types/domain";
import { buildOpenApiContext, toAllowedOperations } from "../connections/openApiOperations";
import { composeModelPrompt } from "./PromptComposer";

export function buildModelRequest(model: ModelConfig, prompt: string, spec: OpenApiSummary | null, template?: PageSpec, promptTemplate?: PromptTemplate | string) {
  const allowedOperations = toAllowedOperations(spec);
  const composed = composeModelPrompt({ prompt, template, promptTemplate, allowedOperations });
  return {
    prompt: composed.prompt,
    base_url: model.baseUrl,
    protocol: model.protocol,
    model: model.model,
    secret_ref: model.secretRef,
    api_key: model.apiKey || null,
    openapi_context: buildOpenApiContext(spec),
    allowed_operations: allowedOperations,
    custom_headers: model.customHeaders,
    custom_header_secret_refs: model.customHeaderSecretRefs,
    timeout_seconds: model.timeoutSeconds,
    temperature: model.temperature,
    max_tokens: model.maxTokens,
    structured_output: model.structuredOutput,
    streaming: model.streaming,
    system_prompt: composed.systemPrompt,
  };
}
