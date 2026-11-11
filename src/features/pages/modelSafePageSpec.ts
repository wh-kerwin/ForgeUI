import type { PageSpec } from "../../types/domain";
import { forModel, projectArtifact } from "./contracts/pageProjections";

/** Only UI structure can be sent to a model; loaded business rows and metrics stay local. */
export function toModelSafePageSpec(page: PageSpec): PageSpec {
  return forModel(page);
}

/**
 * Dropping data fields is expected, but losing structure to a size limit must be
 * rejected by the caller rather than silently shrinking the model context.
 */
export function modelProjectionBlockingIssues(page: PageSpec): string[] {
  return projectArtifact(page, "model").issues.filter(
    (code) => code === "projection.text_limit" || code === "projection.array_limit",
  );
}
