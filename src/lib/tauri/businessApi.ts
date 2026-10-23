export type BusinessApiRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  project_id?: string;
  api_document_id?: string;
  operation_key?: string;
  request_id?: string;
};

export type BusinessApiResponse = { status: number; body: unknown };

export type BusinessApiInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type ClassifiedErrorKind = "cancelled" | "mutation-outcome-unknown";
type ClassifiedBusinessError = Error & { kind?: ClassifiedErrorKind };

function classifyError(error: unknown, kind: "query" | "mutation"): ClassifiedBusinessError {
  const message =
    typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  const classified = new Error(message) as ClassifiedBusinessError;
  if (kind === "query" && message === "Cancelled") classified.kind = "cancelled";
  if (kind === "mutation" && message.startsWith("MutationOutcomeUnknown"))
    classified.kind = "mutation-outcome-unknown";
  return classified;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export async function executeBusinessApi(
  request: BusinessApiRequest,
  options: {
    invoke: BusinessApiInvoke;
    kind: "query" | "mutation";
    newRequestId?: () => string;
  },
): Promise<BusinessApiResponse> {
  const requestId =
    options.kind === "query" ? (options.newRequestId ?? createRequestId)() : undefined;
  const payload = { ...request };
  delete payload.request_id;
  if (options.kind === "query") {
    if (!requestId?.trim()) throw new Error("查询请求 ID 不能为空");
    payload.request_id = requestId;
  }
  try {
    return await options.invoke<BusinessApiResponse>("execute_api", { request: payload });
  } catch (error) {
    throw classifyError(error, options.kind);
  }
}

export function cancelBusinessQuery(requestId: string, invoke: BusinessApiInvoke): Promise<number> {
  return invoke<number>("cancel_query", { requestId });
}
