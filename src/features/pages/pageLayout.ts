import type { PageSpec } from "../../types/domain";

export function resolvePageLayout(
  page: Pick<PageSpec, "layout">,
  isStreaming = false,
): NonNullable<PageSpec["layout"]> {
  return isStreaming ? "full" : (page.layout ?? "full");
}
