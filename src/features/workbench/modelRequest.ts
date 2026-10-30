import type { ApiDocument, ModelConfig, PageSpec, PromptTemplate } from "../../types/domain";
import {
  allowedOperationsForDocuments,
  inferOperationRoles,
} from "../connections/openApiOperations";
import { composeModelPrompt, PromptCompositionError } from "./PromptComposer";
import { capabilityForScene, capabilityGap } from "../pages/capabilities/businessCapabilityCatalog";

export function buildModelRequest(
  model: ModelConfig,
  prompt: string,
  documents: readonly ApiDocument[],
  template?: PageSpec,
  promptTemplate?: PromptTemplate | string,
) {
  const allowedOperations = allowedOperationsForDocuments(documents);
  const composed = composeModelPrompt({ prompt, template, promptTemplate, allowedOperations });
  const capability = capabilityForScene(
    typeof promptTemplate === "object" ? promptTemplate.scene : "query",
  );
  const gap =
    capability &&
    capabilityGap(
      capability,
      allowedOperations.flatMap((operation) =>
        (inferOperationRoles([operation])[operation.operation_id] ?? []).map((role) => ({
          method: operation.method,
          path: operation.path,
          role,
        })),
      ),
    );
  if (gap) {
    const localized = gap.replace(
      /create|update|delete/g,
      (role) => ({ create: "新增", update: "编辑", delete: "删除" })[role] ?? role,
    );
    throw new PromptCompositionError(localized, "capability_gap");
  }

  return {
    prompt: composed.prompt,
    base_url: model.baseUrl,
    protocol: model.protocol,
    model: model.model,
    secret_ref: model.secretRef,
    api_key: model.apiKey || null,
    openapi_context: composed.openapiContext || undefined,
    prompt_diagnostics: composed.diagnostics,
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
