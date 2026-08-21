import type { PageSpec } from "../../types/domain";

export function operationKey(method: string, path: string, operationId: string) {
  return `${method} ${path} · ${operationId}`;
}

export function pageOperations(page: PageSpec, importedOperations: string[]) {
  if (!page.operations?.length) return importedOperations;
  return page.operations.map((binding) => operationKey(binding.method, binding.path, binding.operation_id));
}

export function firstOperation(operations: string[], method: string, requiresPathParameter = false) {
  return operations.find((operation) => operation.startsWith(`${method} `) && (!requiresPathParameter || /\{[^}]+\}/.test(operation)));
}

export function operationForRole(page: PageSpec, importedOperations: string[], role: string, method: string, requiresPathParameter = false) {
  const binding = page.operations?.find((item) => item.role === role && item.method === method);
  if (binding) return operationKey(binding.method, binding.path, binding.operation_id);
  return firstOperation(importedOperations, method, requiresPathParameter);
}
