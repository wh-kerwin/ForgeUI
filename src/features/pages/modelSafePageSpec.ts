import type { PageSpec } from "../../types/domain";

/** Only UI structure can be sent to a model; loaded business rows and metrics stay local. */
export function toModelSafePageSpec(page: PageSpec): PageSpec {
  return {
    version: page.version,
    title: page.title,
    description: page.description,
    layout: page.layout,
    breadcrumb: page.breadcrumb,
    permissionRole: page.permissionRole,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    filters: page.filters,
    columns: page.columns,
    columnMeta: page.columnMeta,
    operations: page.operations,
    views: page.views,
    interaction: page.interaction,
    batchActions: page.batchActions,
    theme: page.theme,
    styleTokens: page.styleTokens,
    stats: [],
    rows: [],
  };
}
