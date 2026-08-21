export type Protocol = "openai" | "anthropic";

export type ModelConfig = {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  secretRef?: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  enabled: boolean;
  timeoutSeconds: number;
  structuredOutput: "jsonSchema" | "jsonObject" | "prompt";
  customHeaders: Record<string, string>;
  customHeaderSecretRefs?: Record<string, string>;
  notes: string;
};

export type PageSpec = {
  version?: number;
  title: string;
  description: string;
  filters: string[];
  stats: { label: string; value: string }[];
  columns: string[];
  rows: string[][];
  operations?: { operation_id: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; role: string }[];
};

export type OpenApiSummary = {
  title: string;
  version: string;
  spec_version: string;
  operation_count: number;
  operations: string[];
  api_base_url: string;
  discovered_url: string;
};

export type AllowedOperation = { operation_id: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };

export type BusinessAuth = {
  type: string;
  secretRef: string;
  apiKeyName: string;
  caPem: string;
  apiBaseUrl?: string;
  authorizedOperations?: string[];
};

export type TemplateRecord = {
  id: string;
  name: string;
  payload: string;
  version: number;
  updatedAt: string;
  modelId?: string | null;
};
export type TemplateVersion = {
  version: number;
  payload: string;
  createdAt: string;
};

export type GenerationSession = {
  id: string;
  modelId: string;
  prompt: string;
  payload: string;
  createdAt: string;
};
