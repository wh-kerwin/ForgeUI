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
  /** Refinements modify an already-authorized definition; no new capability discovery. */
  options?: { skipCapabilityGap?: boolean },
) {
  const allowedOperations = allowedOperationsForDocuments(documents);
  const composed = composeModelPrompt({ prompt, template, promptTemplate, allowedOperations });
  const capability = capabilityForScene(
    typeof promptTemplate === "object" ? promptTemplate.scene : "query",
  );
  const gap =
    !options?.skipCapabilityGap &&
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
    // composeModelPrompt embeds only the structural template projection here;
    // loaded rows, literal stats and credentials never enter the request.
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

/**
 * Refinement requests carry only the bounded user instruction, the structural
 * projection of the current definition (added by composeModelPrompt) and the
 * documents already authorized for that definition — never the active document
 * union. Callers must filter `documents` to the original scope first.
 */
export function buildRefineModelRequest(
  model: ModelConfig,
  instruction: string,
  documents: readonly ApiDocument[],
  current: PageSpec,
  promptTemplate?: PromptTemplate | string,
) {
  const bounded = instruction.slice(0, 1000);
  return buildModelRequest(
    model,
    `局部修改现有页面定义，只输出一个完整的页面定义 JSON，不输出解释。用户指令：${bounded}`,
    documents,
    current,
    promptTemplate,
    { skipCapabilityGap: true },
  );
}
