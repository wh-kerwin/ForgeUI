import type { AllowedOperation, PageSpec, PromptTemplate } from "../../types/domain";
import { inferOperationRoles } from "../connections/openApiOperations";
import { toModelSafePageSpec } from "../pages/modelSafePageSpec";

type PromptComposerInput = {
  prompt: string;
  template?: PageSpec;
  promptTemplate?: PromptTemplate | string;
  allowedOperations: AllowedOperation[];
};

const CONSTRAINTS = [
  "Return one valid PageSpec JSON object only. Never wrap it in markdown or add explanations.",
  "Use the same language as the user's request for title, description, labels, and user-facing text.",
  "filters and columns must be arrays of strings; every row must contain exactly one string cell per column.",
  "Every view reference (defaultSort.column, chart axes/group, and kanban group/card fields) must exactly match one string in columns. Omit a view when its required columns are unavailable.",
  "Keep the PageSpec compact: use at most 10 columns, 4 sample rows, and 3 top-level views; omit optional metadata that does not improve the requested screen.",
  "Only bind apiDocumentId, operation_id, method, and path combinations listed in OPENAPI_CONTEXT. Never invent an operation or document identity.",
  "Every generated operation and batch action binding must copy apiDocumentId from its matching OPENAPI_CONTEXT operation.",
  "For create/update bindings, copy the matching OPENAPI_CONTEXT bodySchemas entry into bodySchema when available, including visibleWhen conditions.",
  "Use list, chart, kanban, tabs, and split view types. Keep a list fallback when another view is primary and limit nested composition to four levels.",
  "Set layout to full by default so filters and stats render above the main view. Use sidebar only when the user explicitly requests a sidebar or side-by-side filter layout.",
  "Set theme to enterprise-blue for explicit enterprise blue requests, clean-light for light/clean requests, minimal-dark for explicit minimal dark requests, otherwise forge-default.",
  "For consumer/C-end requests set create, update, delete, and detail interaction modes to modal. For B-end admin requests keep compatible defaults unless the user explicitly requests modal/dialog interaction; explicit detail/view or update/edit modal instructions must set the matching interaction field to modal.",
  "Treat FEW_SHOT as a structural example only. Do not copy its labels, values, or placeholder identifiers.",
];

const SCENE_RULES: Record<PromptTemplate["scene"], string[]> = {
  dashboard: [
    "Prioritize decision-ready stats and trend charts supported by real columns.",
    "Prefer line charts for time series, bars for comparisons, and pie charts only for small category sets.",
  ],
  crud: [
    "Prioritize searchable list, detail, create, update, and delete flows when matching authorized operations exist.",
    "Bind each action to the matching role and keep destructive actions explicit.",
  ],
  report: [
    "Prioritize date/range filters, readable summaries, pagination-ready tables, and export-friendly columns.",
    "Keep reporting interactions read-only unless an authorized mutation is explicitly required.",
  ],
  kanban: [
    "Prioritize a kanban view grouped by a real status/category column and show concise identifying card fields.",
    "Also provide a list fallback and never imply persistence without an authorized update operation.",
  ],
  shop: [
    "Prioritize product discovery, clear price/availability, and lightweight modal interactions.",
    "Use consumer-facing copy and avoid dense administrative controls.",
  ],
  content: [
    "Prioritize readable content hierarchy, category discovery, and detail previews.",
    "Keep editorial metadata concise and use modal detail when it preserves reading context.",
  ],
  social: [
    "Prioritize identity, activity feeds, and safe lightweight interactions.",
    "Do not invent social mutations without matching authorized operations.",
  ],
};

const FEW_SHOTS: Record<PromptTemplate["scene"], object> = {
  dashboard: {
    version: 1,
    title: "Order overview",
    description: "Key totals and recent trend",
    filters: ["date"],
    stats: [{ label: "Orders", value: "1,234" }],
    columns: ["Date", "Orders"],
    rows: [["2026-08-24", "120"]],
    operations: [],
    views: [
      { type: "list", title: "Data" },
      {
        type: "chart",
        title: "Trend",
        chartType: "line",
        xAxisColumn: "Date",
        yAxisColumn: "Orders",
      },
    ],
  },
  crud: {
    version: 1,
    title: "Device manager",
    description: "Search and maintain devices",
    filters: ["Status"],
    stats: [],
    columns: ["ID", "Name", "Status"],
    rows: [["1", "Device A", "Active"]],
    operations: [],
    views: [{ type: "list", title: "Devices" }],
  },
  report: {
    version: 1,
    title: "Monthly report",
    description: "Auditable monthly summary",
    filters: ["Month"],
    stats: [{ label: "Total", value: "56,789" }],
    columns: ["Month", "Total"],
    rows: [["2026-08", "56,789"]],
    operations: [],
    views: [{ type: "list", title: "Report" }],
  },
  kanban: {
    version: 1,
    title: "Work board",
    description: "Work grouped by status",
    filters: ["Owner"],
    stats: [],
    columns: ["ID", "Title", "Status", "Owner"],
    rows: [["1", "Draft proposal", "Todo", "Alex"]],
    operations: [],
    views: [
      { type: "list", title: "All work" },
      { type: "kanban", title: "Board", groupColumn: "Status", cardFields: ["Title", "Owner"] },
    ],
  },
  shop: {
    version: 1,
    title: "Catalog",
    description: "Browse available products",
    filters: ["Category"],
    stats: [],
    columns: ["ID", "Product", "Price"],
    rows: [["1", "Product A", "99.00"]],
    operations: [],
    views: [{ type: "list", title: "Products" }],
    interaction: { detail: "modal" },
    theme: "clean-light",
  },
  content: {
    version: 1,
    title: "Stories",
    description: "Recent published content",
    filters: ["Category"],
    stats: [],
    columns: ["ID", "Title", "Published"],
    rows: [["1", "Story A", "2026-08-25"]],
    operations: [],
    views: [{ type: "list", title: "Latest" }],
    interaction: { detail: "modal" },
    theme: "clean-light",
  },
  social: {
    version: 1,
    title: "Community",
    description: "Recent activity",
    filters: ["Topic"],
    stats: [],
    columns: ["ID", "Author", "Post"],
    rows: [["1", "Alex", "Update"]],
    operations: [],
    views: [{ type: "list", title: "Feed" }],
    interaction: { detail: "modal" },
    theme: "minimal-dark",
  },
};

function sceneOf(template?: PromptTemplate | string): PromptTemplate["scene"] {
  return typeof template === "object" ? template.scene : "dashboard";
}

function scenePromptOf(template?: PromptTemplate | string): string {
  return typeof template === "string" ? template : (template?.systemPrompt ?? "");
}

function compactTemplateContext(template?: PageSpec): string {
  if (!template) return "None";
  const safe = toModelSafePageSpec(template);
  const full = JSON.stringify(safe);
  if (full.length <= 1000) return full;
  return JSON.stringify({
    ...safe,
    columns: safe.columns.slice(0, 20),
    operations: safe.operations?.slice(0, 10),
    views: safe.views?.slice(0, 5),
    truncated: true,
  });
}

function compactOperationContext(operations: AllowedOperation[]): string {
  const compact = operations.slice(0, 16).map(({ api_document_id, ...operation }) => ({
    apiDocumentId: api_document_id,
    ...operation,
    suggested_roles: inferOperationRoles([operation])[operation.operation_id] ?? [],
  }));
  return JSON.stringify({
    operations: compact,
    omitted: Math.max(0, operations.length - compact.length),
  });
}

export function composeModelPrompt({
  prompt,
  template,
  promptTemplate,
  allowedOperations,
}: PromptComposerInput) {
  const scene = sceneOf(promptTemplate);
  const operationContext = compactOperationContext(allowedOperations);
  const templateContext = compactTemplateContext(template);
  const customScenePrompt = scenePromptOf(promptTemplate).trim().slice(0, 600);
  const layers = [
    "【PERSONA】\nYou are a senior product designer generating safe B2B and consumer-facing business interfaces.",
    `【CONSTRAINTS】\n${CONSTRAINTS.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`,
    `【SCENE】\nScene: ${scene}\n${SCENE_RULES[scene].join("\n")}${customScenePrompt ? `\nAdditional scene direction: ${customScenePrompt}` : ""}`,
    `【TEMPLATE_CONTEXT】\n${templateContext}\nWhen a template exists, preserve all operation bindings exactly. Unsupported requested actions must remain local UI interactions.`,
    `【OPENAPI_CONTEXT】\n${operationContext}\nSuggested roles are hints; the operation tuple remains authoritative. Full operations remain available in the request context.`,
    `【FEW_SHOT】\n${JSON.stringify(FEW_SHOTS[scene])}`,
  ];

  return { prompt, systemPrompt: layers.join("\n\n"), scene };
}
