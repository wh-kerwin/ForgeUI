export type PageIssue = {
  code: string;
  path: string;
  severity: "error" | "warning";
  stage: "syntax" | "schema" | "reference" | "binding" | "permission";
  message: string;
  suggestedFix?: string;
};

/** Messages and paths must be authored by the validator, never copied from input. */
export function pageIssue(
  code: string,
  path: string,
  stage: PageIssue["stage"],
  message: string,
  severity: PageIssue["severity"] = "error",
): PageIssue {
  return { code, path, stage, severity, message };
}
