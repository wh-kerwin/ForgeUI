import type { PageView } from "../../types/domain";

export type PageSort = NonNullable<Extract<PageView, { type: "list" }>["defaultSort"]>;
export type GeneratedAction = "create" | "update" | "delete" | "detail";

const FILTER_ALIASES: Record<string, string[]> = {
  name: ["name", "keyword", "q", "search"],
  姓名: ["keyword", "name", "q", "search"],
  名称: ["name", "keyword", "q", "search"],
  keyword: ["keyword", "q", "search", "name"],
  关键词: ["keyword", "q", "search", "name"],
  department: ["department", "departmentId", "dept", "deptId"],
  部门: ["department", "departmentId", "dept", "deptId"],
  status: ["status", "state"],
  状态: ["status", "state"],
};

const COMMON_LIST_CONTROL_PARAMETERS = new Set([
  "page",
  "pagesize",
  "limit",
  "offset",
  "cursor",
  "sort",
  "order",
  "orderby",
]);

export function listFilterParameters(
  queryParameters: readonly string[] | undefined,
  pageParam: string,
  sizeParam: string,
  sortParam?: string,
) {
  if (queryParameters === undefined) return undefined;
  const controls = new Set(
    [pageParam, sizeParam, sortParam ?? ""].map((parameter) => parameter.toLocaleLowerCase()),
  );
  return [...new Set(queryParameters)].filter((parameter) => {
    const normalized = parameter.toLocaleLowerCase();
    return !controls.has(normalized) && !COMMON_LIST_CONTROL_PARAMETERS.has(normalized);
  });
}

export function queryFilters(filters: Record<string, string>, queryParameters?: readonly string[]) {
  const allowed = queryParameters?.length
    ? new Map(queryParameters.map((name) => [name.toLocaleLowerCase(), name]))
    : null;
  return Object.fromEntries(
    Object.entries(filters).flatMap(([label, value]) => {
      if (!value.trim()) return [];
      if (!allowed) return [[FILTER_ALIASES[label]?.[0] ?? label, value]];
      const parameter = [label, ...(FILTER_ALIASES[label] ?? [])]
        .map((name) => allowed.get(name.toLocaleLowerCase()))
        .find(Boolean);
      return parameter ? [[parameter, value]] : [];
    }),
  );
}

export function parseGrantedRoles(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\n]/)
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  ]
    .slice(0, 50)
    .map((role) => role.slice(0, 120));
}

export function hasPageAccess(
  requiredRole: string | undefined,
  grantedRoles: string[] | undefined,
): boolean {
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
  queryParameters,
}: {
  filters: Record<string, string>;
  page: number;
  size: number;
  pageParam: string;
  sizeParam: string;
  sortParam?: string;
  sort?: PageSort | null;
  queryParameters?: readonly string[];
}): Record<string, string> {
  const query = {
    ...queryFilters(filters, queryParameters),
    [pageParam]: String(page),
    [sizeParam]: String(size),
  };
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
