import type { AllowedOperation, OpenApiSummary } from "../../types/domain";

export function toAllowedOperations(spec: OpenApiSummary | null): AllowedOperation[] {
  if (!spec) return [];
  return spec.operations.flatMap((operation) => {
    const [methodAndPath, operationId] = operation.split(" · ");
    const [method, path] = methodAndPath.split(" ");
    if (!method || !path || !operationId || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return [];
    return [{ operation_id: operationId, method: method as AllowedOperation["method"], path }];
  });
}

export function inferOperationRoles(operations: AllowedOperation[]): Record<string, string[]> {
  return Object.fromEntries(operations.map((operation) => {
    const hasPathParameter = /\{[^}]+\}|\/:\w+/.test(operation.path);
    const roles: string[] = [];
    if (operation.method === "GET") roles.push(hasPathParameter ? "detail" : "list", ...(hasPathParameter ? [] : ["stat"]));
    else if (operation.method === "POST") roles.push("create");
    else if (operation.method === "PUT" || operation.method === "PATCH") roles.push("update");
    else if (operation.method === "DELETE") roles.push("delete");
    if (/\/(export|download)(?:\/|$)/i.test(operation.path)) roles.push("export");
    return [operation.operation_id, [...new Set(roles)]];
  }));
}

export function buildOpenApiContext(spec: OpenApiSummary | null) {
  if (!spec) return undefined;
  const operations = toAllowedOperations(spec);
  const bodySchemas = Object.fromEntries(operations.slice(0, 16).flatMap((operation) => {
    const fields = spec.fieldSchemas?.[operation.operation_id]?.slice(0, 50);
    return fields?.length ? [[operation.operation_id, fields.map((field) => ({ ...field, description: field.description?.slice(0, 200) }))]] : [];
  }));
  return JSON.stringify({ title: spec.title, specVersion: spec.spec_version, operations, inferredRoles: inferOperationRoles(operations), bodySchemas });
}
