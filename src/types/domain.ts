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
  promptTemplateId?: string;
  notes: string;
};

export type PageSpec = {
  version?: number;
  title: string;
  description: string;
  layout?: "sidebar" | "full" | "modal";
  breadcrumb?: string[];
  permissionRole?: string;
  createdAt?: string;
  updatedAt?: string;
  filters: string[];
  stats: { label: string; value: string }[];
  columns: string[];
  columnMeta?: ColumnMeta[];
  rows: string[][];
  operations?: OperationBinding[];
  views?: PageView[];
  interaction?: Partial<Record<"create" | "update" | "delete" | "detail", InteractionMode>>;
  batchActions?: BatchAction[];
  theme?: ThemeStyle;
  styleTokens?: StyleToken;
};

export type ThemeStyle = "forge-default" | "enterprise-blue" | "clean-light" | "minimal-dark" | "custom";
export type StyleToken = {
  primary?: string; primaryBg?: string; primaryBgHover?: string;
  surface?: string; surfaceAlt?: string; surfaceControl?: string;
  border?: string; borderControl?: string; focusRing?: string;
  text?: string; textMuted?: string; textSubtle?: string;
  danger?: string; dangerBg?: string; success?: string;
  radius?: "none" | "sm" | "md" | "lg" | "full";
  density?: "compact" | "comfortable" | "relaxed";
};

export type ColumnMeta = {
  name: string;
  type: "string" | "number" | "date" | "datetime" | "enum" | "boolean" | "money";
  format?: string;
  enumLabels?: Record<string, string>;
  sortable?: boolean;
  filterable?: boolean;
  searchMode?: "exact" | "fuzzy" | "range";
  width?: string;
  visible?: boolean;
};

export type BatchAction = {
  apiDocumentId?: string;
  operation_id: string;
  method: "POST" | "DELETE";
  path: string;
  confirmMessage?: string;
  payloadBuilder: { type: "ids" | "custom"; customPayload?: string };
};

export type InteractionMode = "modal" | "drawer" | "inline" | "redirect";

export type OperationBinding = {
  apiDocumentId?: string;
  operation_id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  role: "list" | "detail" | "create" | "update" | "delete" | "stat" | "export" | "stats" | "read";
  bodySchema?: FieldSchema[];
  confirmMessage?: string;
  pagination?: { pageParam: string; sizeParam: string; defaultSize: number };
  sortParam?: string;
};

export type PromptTemplate = { id: string; name: string; scene: "dashboard" | "crud" | "report" | "kanban" | "shop" | "content" | "social"; systemPrompt: string; isDefault?: boolean };
export type LoadingState = "idle" | "generating" | "querying" | "mutating" | "saving";

export type PageView =
  | { type: "list"; title?: string; defaultSort?: { column: string; order: "asc" | "desc" } }
  | { type: "chart"; title: string; chartType: "bar" | "line" | "pie"; xAxisColumn: string; yAxisColumn: string; groupByColumn?: string }
  | { type: "kanban"; title: string; groupColumn: string; cardFields: string[] }
  | { type: "tabs"; items: { key: string; label: string; view: PageView }[] }
  | { type: "split"; left: PageView; right: PageView; splitRatio?: number };

export type OpenApiSummary = {
  title: string;
  version: string;
  spec_version: string;
  operation_count: number;
  operations: string[];
  api_base_url: string;
  discovered_url: string;
  fieldSchemas?: Record<string, FieldSchema[]>;
  queryParameters?: Record<string, string[]>;
};

export type Project = {
  id: string;
  name: string;
  selectedApiDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ApiDocument = {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  spec: OpenApiSummary;
  auth: BusinessAuth;
  createdAt: string;
  updatedAt: string;
};

export type FieldSchema = {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "date" | "enum";
  enumValues?: string[];
  required: boolean;
  description?: string;
  visibleWhen?: { field: string; equals: string | string[] };
};

export type AllowedOperation = { api_document_id?: string; operation_id: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string };

export type BusinessAuth = {
  type: string;
  secretRef: string;
  apiKeyName: string;
  caPem: string;
  apiBaseUrl?: string;
  authorizedOperations?: string[];
  grantedRoles?: string[];
  openApiSpec?: OpenApiSummary;
};

export type TemplateRecord = {
  id: string;
  projectId: string;
  name: string;
  payload: string;
  version: number;
  updatedAt: string;
  modelId?: string | null;
  apiDocumentIds: string[];
};
export type TemplateVersion = {
  version: number;
  payload: string;
  createdAt: string;
};

export type GenerationSession = {
  id: string;
  projectId: string;
  modelId: string;
  prompt: string;
  payload: string;
  createdAt: string;
  apiDocumentIds: string[];
};
