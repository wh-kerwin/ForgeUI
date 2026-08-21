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

export function buildOpenApiContext(spec: OpenApiSummary | null) {
  if (!spec) return undefined;
  return JSON.stringify({ title: spec.title, specVersion: spec.spec_version, operations: toAllowedOperations(spec) });
}
