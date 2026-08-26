import type { PageView } from "../../types/domain";

export type PageSort = NonNullable<Extract<PageView, { type: "list" }>["defaultSort"]>;
export type GeneratedAction = "create" | "update" | "delete" | "detail";

export function parseGrantedRoles(value: string): string[] {
  return [...new Set(value.split(/[,;\n]/).map((role) => role.trim()).filter(Boolean))]
    .slice(0, 50)
    .map((role) => role.slice(0, 120));
}

export function hasPageAccess(requiredRole: string | undefined, grantedRoles: string[] | undefined): boolean {
  const required = requiredRole?.trim();
  if (!required) return true;
  return (grantedRoles ?? []).some((role) => role.trim() === required);
}

export function firstListSort(view: PageView | undefined): PageSort | null {
  if (!view) return null;
  if (view.type === "list") return view.defaultSort ?? null;
  if (view.type === "tabs") return firstListSort(view.items[0]?.view);
  if (view.type === "split") return firstListSort(view.left) ?? firstListSort(view.right);
  return null;
}

export function buildListQuery({
  filters,
  page,
  size,
  pageParam,
  sizeParam,
  sortParam,
  sort,
}: {
  filters: Record<string, string>;
  page: number;
  size: number;
  pageParam: string;
  sizeParam: string;
  sortParam?: string;
  sort?: PageSort | null;
}): Record<string, string> {
  const query = { ...filters, [pageParam]: String(page), [sizeParam]: String(size) };
  if (sortParam && sort) query[sortParam] = `${sort.column},${sort.order}`;
  return query;
}

export function generatedActionPath(action: GeneratedAction, rowId?: string): string {
  const suffix = rowId ? `/${encodeURIComponent(rowId)}` : "";
  return `/generate/${action}${suffix}`;
}

export function isGeneratedActionPath(pathname: string): boolean {
  return /^\/generate\/(?:create|update|delete|detail)(?:\/|$)/.test(pathname);
}
