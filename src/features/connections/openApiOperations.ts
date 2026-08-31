import type { AllowedOperation, ApiDocument, OpenApiSummary } from "../../types/domain";

export function toAllowedOperations(
  spec: OpenApiSummary | null,
  apiDocumentId?: string,
  authorizedOperations?: readonly string[],
): AllowedOperation[] {
  if (!spec) return [];
  const authorized = authorizedOperations ? new Set(authorizedOperations) : null;
  return spec.operations.flatMap((operation) => {
    if (authorized && !authorized.has(operation)) return [];
    const [methodAndPath, operationId] = operation.split(" · ");
    const [method, path] = methodAndPath.split(" ");
    if (
      !method ||
      !path ||
      !operationId ||
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)
    )
      return [];
    return [
      {
        ...(apiDocumentId ? { api_document_id: apiDocumentId } : {}),
        operation_id: operationId,
        method: method as AllowedOperation["method"],
        path,
      },
    ];
  });
}

export function allowedOperationsForDocuments(
  documents: readonly ApiDocument[],
): AllowedOperation[] {
  return documents
    .filter((document) => document.enabled)
    .flatMap((document) =>
      toAllowedOperations(document.spec, document.id, document.auth.authorizedOperations ?? []),
    );
}

export function inferOperationRoles(operations: AllowedOperation[]): Record<string, string[]> {
  return Object.fromEntries(
    operations.map((operation) => {
      const hasPathParameter = /\{[^}]+\}|\/:\w+/.test(operation.path);
      const roles: string[] = [];
      if (operation.method === "GET")
        roles.push(hasPathParameter ? "detail" : "list", ...(hasPathParameter ? [] : ["stat"]));
      else if (operation.method === "POST") roles.push("create");
      else if (operation.method === "PUT" || operation.method === "PATCH") roles.push("update");
      else if (operation.method === "DELETE") roles.push("delete");
      if (/\/(export|download)(?:\/|$)/i.test(operation.path)) roles.push("export");
      return [operation.operation_id, [...new Set(roles)]];
    }),
  );
}

export function buildOpenApiContext(documents: readonly ApiDocument[]) {
  const contexts = documents
    .filter((document) => document.enabled)
    .map((document) => {
      const operations = toAllowedOperations(
        document.spec,
        document.id,
        document.auth.authorizedOperations ?? [],
      );
      const bodySchemas = Object.fromEntries(
        operations.slice(0, 16).flatMap((operation) => {
          const fields = document.spec.fieldSchemas?.[operation.operation_id]?.slice(0, 50);
          return fields?.length
            ? [
                [
                  operation.operation_id,
                  fields.map((field) => ({
                    ...field,
                    description: field.description?.slice(0, 200),
                  })),
                ],
              ]
            : [];
        }),
      );
      return {
        apiDocumentId: document.id,
        name: document.name,
        title: document.spec.title,
        specVersion: document.spec.spec_version,
        apiBaseUrl: document.spec.api_base_url,
        operations: operations.map((operation) => ({
          apiDocumentId: document.id,
          operation_id: operation.operation_id,
          method: operation.method,
          path: operation.path,
          ...(document.spec.queryParameters?.[operation.operation_id]
            ? { queryParameters: document.spec.queryParameters[operation.operation_id] }
            : {}),
        })),
        inferredRoles: inferOperationRoles(operations),
        bodySchemas,
      };
    });
  return contexts.length ? JSON.stringify({ documents: contexts }) : undefined;
}
