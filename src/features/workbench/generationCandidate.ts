import type { GenerationFailure, PageSpec } from "../../types/domain";
import { parsePageSpecDetailed } from "../pages/parsePageSpec";
import { alignListOperationWithPrompt, type RuntimeOperation } from "../pages/pageOperations";

/** Both generation paths must validate before saving and must never rewrite API identity. */
export function validateGenerationCandidate(
  page: PageSpec,
  prompt: string,
  operations: RuntimeOperation[],
): PageSpec {
  const checked = parsePageSpecDetailed(page);
  if (!checked.page) throw { issues: checked.issues, retryable: false } satisfies GenerationFailure;
  const aligned = alignListOperationWithPrompt(checked.page, prompt, operations);
  if (JSON.stringify(aligned.operations) !== JSON.stringify(checked.page.operations)) {
    throw {
      retryable: false,
      issues: [
        {
          code: "generation.binding_mismatch",
          stage: "binding",
          severity: "error",
          path: "/operations",
          message: "页面 API 与请求不匹配，请调整描述后重新生成",
        },
      ],
    } satisfies GenerationFailure;
  }
  return checked.page;
}
