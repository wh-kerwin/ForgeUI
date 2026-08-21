import type { PageSpec } from "../../types/domain";

/** Only UI structure can be sent to a model; loaded business rows and metrics stay local. */
export function toModelSafePageSpec(page: PageSpec): PageSpec {
  return {
    version: page.version,
    title: page.title,
    description: page.description,
    filters: page.filters,
    columns: page.columns,
    operations: page.operations,
    stats: [],
    rows: [],
  };
}
