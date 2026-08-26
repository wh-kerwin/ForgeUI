import type { ApiDocument, OperationBinding, PageSpec } from "../../types/domain";

export type RuntimeOperation = {
  key: string;
  method: OperationBinding["method"];
  path: string;
  operationId: string;
  apiDocumentId?: string;
  queryParameters?: string[];
};

export function operationKey(method: string, path: string, operationId: string) {
  return `${method} ${path} · ${operationId}`;
}

const supportedMethods: OperationBinding["method"][] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function runtimeOperationFromKey(key: string, apiDocumentId?: string, queryParameters?: readonly string[]): RuntimeOperation | null {
  const [target, operationId, ...extra] = key.split(" · ");
  const separator = target?.indexOf(" ") ?? -1;
  const method = target?.slice(0, separator) as OperationBinding["method"];
  const path = target?.slice(separator + 1);
  if (extra.length || separator < 1 || !supportedMethods.includes(method) || !path || !operationId) return null;
  return { key, method, path, operationId, apiDocumentId, ...(queryParameters ? { queryParameters: [...queryParameters] } : {}) };
}

export function runtimeOperations(operationKeys: string[], apiDocumentId?: string, queryParameters?: Record<string, string[]>): RuntimeOperation[] {
  return operationKeys.flatMap((key) => {
    const operationId = key.split(" · ")[1];
    const operation = runtimeOperationFromKey(key, apiDocumentId, operationId ? queryParameters?.[operationId] : undefined);
    return operation ? [operation] : [];
  });
}

export function runtimeOperation(binding: Pick<OperationBinding, "method" | "path" | "operation_id" | "apiDocumentId">): RuntimeOperation {
  return {
    key: operationKey(binding.method, binding.path, binding.operation_id),
    method: binding.method,
    path: binding.path,
    operationId: binding.operation_id,
    apiDocumentId: binding.apiDocumentId,
  };
}

export function pageOperations(page: PageSpec, importedOperations: RuntimeOperation[]) {
  if (!page.operations?.length) return importedOperations;
  return page.operations.map((binding) => resolveDocumentBinding(runtimeOperation(binding), importedOperations));
}

function resolveDocumentBinding(operation: RuntimeOperation, importedOperations: RuntimeOperation[]) {
  const matches = importedOperations.filter((candidate) => candidate.key === operation.key && candidate.apiDocumentId && (!operation.apiDocumentId || candidate.apiDocumentId === operation.apiDocumentId));
  if (matches.length !== 1) return operation;
  return { ...operation, apiDocumentId: matches[0].apiDocumentId, queryParameters: matches[0].queryParameters };
}

export function firstOperation(operations: RuntimeOperation[], method: string, requiresPathParameter = false) {
  return operations.find((operation) => {
    if (operation.method !== method) return false;
    const hasPathParameter = /\{[^}]+\}/.test(operation.path);
    return requiresPathParameter ? hasPathParameter : !hasPathParameter;
  });
}

export function operationForRole(page: PageSpec, importedOperations: RuntimeOperation[], role: string, method: string, requiresPathParameter = false) {
  const binding = page.operations?.find((item) => item.role === role && item.method === method);
  if (binding) return resolveDocumentBinding(runtimeOperation(binding), importedOperations);
  return firstOperation(importedOperations, method, requiresPathParameter);
}

const RESOURCE_ALIASES: Record<string, string[]> = {
  order: ["订单", "order", "orders"],
  customer: ["客户", "customer", "customers", "crm"],
  product: ["商品", "产品", "product", "products", "sku"],
  inventory: ["库存", "inventory", "stock"],
  employee: ["员工", "雇员", "employee", "employees", "staff"],
};

type RequiredCapability = "list" | "create" | "update" | "delete" | "detail";

const CAPABILITY_LABELS: Record<RequiredCapability, string> = {
  list: "列表查询",
  create: "新增",
  update: "编辑",
  delete: "删除",
  detail: "详情查询",
};

function requestedResource(text: string) {
  const normalized = text.toLocaleLowerCase();
  return Object.entries(RESOURCE_ALIASES).find(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))?.[0];
}

function genericRequestedResource(text: string) {
  const firstSentence = text.trim().split(/[，。；;！!\n]/, 1)[0] ?? "";
  const withoutGenerationPrefix = firstSentence
    .replace(/^(?:请)?(?:帮我)?(?:生成|创建|构建|制作|设计|build|create|generate)\s*(?:(?:一个|一套)|an?\s+|the\s+)?/i, "")
    .trim();
  const match = withoutGenerationPrefix.match(/^(.{1,40}?)(?:管理(?:界面|页面|页)?|列表(?:界面|页面|页)?|详情(?:界面|页面|页)?|数据(?:看板|总览)|看板|界面|页面|页|dashboard|\s+(?:management|list|detail|dashboard|page|screen))/i);
  const resource = match?.[1]?.trim().replace(/(?:的|数据|业务|功能|界面|页面|页)$/u, "");
  return resource && resource.length >= 2 ? resource : undefined;
}

function requestedResourceLabel(prompt: string) {
  const genericResource = genericRequestedResource(prompt);
  if (genericResource) return genericResource;
  const knownResource = requestedResource(prompt);
  if (knownResource) return RESOURCE_ALIASES[knownResource][0];
  return undefined;
}

function matchesResourceTerm(candidate: string, term: string) {
  const normalizedCandidate = candidate.toLocaleLowerCase();
  const normalizedTerm = term.toLocaleLowerCase().trim();
  if (!normalizedTerm) return false;
  if (/^[\u4e00-\u9fff]+$/u.test(normalizedTerm)) return normalizedCandidate.includes(normalizedTerm);

  const singular = normalizedTerm.replace(/s$/u, "");
  return [normalizedTerm, singular].filter((value) => value.length >= 3).some((value) => normalizedCandidate.includes(value));
}

function documentMatchesResource(document: ApiDocument, resource: string, aliases: readonly string[]) {
  const candidate = `${document.name} ${document.spec.title} ${document.spec.operations.join(" ")}`;
  return [...aliases, resource].some((term) => matchesResourceTerm(candidate, term));
}

function requiredCapabilities(prompt: string): RequiredCapability[] {
  const normalized = prompt.toLocaleLowerCase();
  const required = new Set<RequiredCapability>();
  if (/(管理|列表|management|\blist\b)/iu.test(normalized)) required.add("list");
  if (/(新增|新建|创建|添加|\bcreate\b|\bnew\b|\badd\b)/iu.test(normalized)) required.add("create");
  if (/(编辑|修改|更新|\bedit\b|\bupdate\b)/iu.test(normalized)) required.add("update");
  if (/(删除|移除|\bdelete\b|\bremove\b)/iu.test(normalized)) required.add("delete");
  if (/(详情|查看|\bdetail\b|\bview\b)/iu.test(normalized)) required.add("detail");
  return [...required];
}

function supportsCapability(operation: RuntimeOperation, capability: RequiredCapability) {
  const hasPathParameter = /\{[^}]+\}|\/:\w+/.test(operation.path);
  if (capability === "list") {
    return operation.method === "GET"
      && !hasPathParameter
      && !/(?:^|\/)(?:stats?|metrics|summary|dashboard|export|download)(?:\/|$)/i.test(operation.path);
  }
  if (capability === "create") return operation.method === "POST" && !hasPathParameter;
  if (capability === "update") return (operation.method === "PUT" || operation.method === "PATCH") && hasPathParameter;
  if (capability === "delete") return operation.method === "DELETE" && hasPathParameter;
  return operation.method === "GET" && hasPathParameter;
}

function missingCapabilities(prompt: string, documents: readonly ApiDocument[]) {
  const operations = documents.flatMap((document) => runtimeOperations(document.auth.authorizedOperations ?? [], document.id, document.spec.queryParameters));
  return requiredCapabilities(prompt).filter((capability) => !operations.some((operation) => supportsCapability(operation, capability)));
}

export function promptMatchesResource(prompt: string, candidate: string) {
  const resource = requestedResource(prompt);
  const genericResource = genericRequestedResource(prompt);
  if (!resource && !genericResource) return false;
  const aliases = resource ? RESOURCE_ALIASES[resource] : [];
  return [...aliases, genericResource ?? ""].some((term) => matchesResourceTerm(candidate, term));
}

export function documentsForPrompt(prompt: string, documents: readonly ApiDocument[]): { documents: ApiDocument[]; error?: string } {
  const resource = requestedResource(prompt);
  const genericResource = genericRequestedResource(prompt);
  const resourceLabel = requestedResourceLabel(prompt);
  if (!resourceLabel) return { documents: [...documents] };
  const aliases = resource && (!genericResource || RESOURCE_ALIASES[resource].includes(genericResource))
    ? RESOURCE_ALIASES[resource]
    : [resourceLabel];
  const matched = documents.filter((document) => documentMatchesResource(document, resourceLabel, aliases));
  if (!matched.length) {
    return { documents: [], error: `请求的“${resourceLabel}”没有可识别的对应 API 接口，已停止生成。请导入或勾选该业务实体的 API 文档后重试。` };
  }
  const missing = missingCapabilities(prompt, matched);
  if (missing.length) {
    return { documents: [], error: `“${resourceLabel}”接口不具备所需的${missing.map((capability) => CAPABILITY_LABELS[capability]).join("、")}能力，已停止生成。` };
  }
  return { documents: matched };
}

/**
 * Models sometimes return a visually plausible page while binding its list to
 * another selected resource. Prefer a single, unambiguous list endpoint whose
 * operation id/path matches the entity explicitly requested by the user.
 */
export function alignListOperationWithPrompt(page: PageSpec, prompt: string, operations: RuntimeOperation[]): PageSpec {
  const resource = requestedResource(`${prompt} ${page.title}`);
  if (!resource) return page;
  const aliases = RESOURCE_ALIASES[resource];
  const candidates = operations.filter((operation) => operation.method === "GET" && !/\{[^}]+\}/.test(operation.path) && aliases.some((alias) => `${operation.path} ${operation.operationId}`.toLocaleLowerCase().includes(alias)));
  if (candidates.length !== 1) return page;

  const preferred = candidates[0];
  const listBinding = page.operations?.find((operation) => operation.role === "list" && operation.method === "GET");
  if (listBinding?.operation_id === preferred.operationId && listBinding.path === preferred.path && listBinding.apiDocumentId === preferred.apiDocumentId) return page;
  const nextBinding = { apiDocumentId: preferred.apiDocumentId, operation_id: preferred.operationId, method: preferred.method, path: preferred.path, role: "list" as const };
  const operationsWithoutList = (page.operations ?? []).filter((operation) => operation !== listBinding);
  return { ...page, operations: [nextBinding, ...operationsWithoutList] };
}

export function bindingForRole(page: PageSpec, role: string, method: string) {
  return page.operations?.find((item) => item.role === role && item.method === method);
}

export function pageApiDocumentIds(page: PageSpec, retainedIds: string[] = []) {
  const bound = [...(page.operations ?? []), ...(page.batchActions ?? [])]
    .map((operation) => operation.apiDocumentId)
    .filter((id): id is string => Boolean(id));
  return [...new Set([...retainedIds, ...bound])];
}
