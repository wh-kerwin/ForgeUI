import type { PromptTemplate } from "../../../types/domain";
import { PAGE_HOST_ACTIONS, PAGE_VIEW_TYPES } from "../viewCapabilities";

export type BusinessCapabilityId = "query" | "crud" | "report" | "dashboard";
export type BusinessViewType = "list" | "chart" | "kanban" | "tabs" | "split";
export type CapabilityViewType = BusinessViewType;
export type CapabilityAction = "read" | "create" | "update" | "delete" | "export" | "aggregate";

export type BusinessCapability = {
  id: BusinessCapabilityId;
  description: string;
  applicableScenes: string[];
  schemaRefs: string[];
  requiredOperationRoles: string[];
  supportedViews: CapabilityViewType[];
  hostActions: CapabilityAction[];
  limits: { maxColumns: number; maxRows: number; maxViews: number };
  safety: string;
  aggregateAlternative?: { scope: "currentPage"; label: string };
};

export const BUSINESS_CAPABILITY_CATALOG: readonly BusinessCapability[] = [
  {
    id: "query",
    description: "Read an authorized list operation and render its mapped records.",
    applicableScenes: ["query"],
    schemaRefs: ["#/properties/columns", "#/properties/operations"],
    requiredOperationRoles: ["list"],
    supportedViews: ["list", "tabs", "split"],
    hostActions: ["read"],
    limits: { maxColumns: 50, maxRows: 100, maxViews: 10 },
    safety: "A detail GET cannot substitute for a list operation.",
  },
  {
    id: "crud",
    description: "Manage records with only the authorized mutations that are available.",
    applicableScenes: ["crud"],
    schemaRefs: ["#/properties/columns", "#/properties/operations", "#/$defs/fieldSchema"],
    requiredOperationRoles: ["list", "create", "update", "delete"],
    supportedViews: ["list", "tabs", "split"],
    hostActions: ["read", "create", "update", "delete"],
    limits: { maxColumns: 50, maxRows: 100, maxViews: 10 },
    safety: "Missing mutations are explained and never invented.",
  },
  {
    id: "report",
    description: "Present an auditable, read-oriented report over the loaded result scope.",
    applicableScenes: ["report"],
    schemaRefs: ["#/properties/columns", "#/properties/columnMeta"],
    requiredOperationRoles: ["list"],
    supportedViews: ["list", "chart", "tabs", "split"],
    hostActions: ["read", "aggregate", "export"],
    limits: { maxColumns: 50, maxRows: 100, maxViews: 10 },
    safety: "Current-page aggregation is not presented as an all-record total.",
    aggregateAlternative: { scope: "currentPage", label: "当前加载结果" },
  },
  {
    id: "dashboard",
    description: "Show bound metrics or explicitly scoped aggregations for decisions.",
    applicableScenes: ["dashboard"],
    schemaRefs: ["#/properties/columns", "#/properties/stats"],
    requiredOperationRoles: ["stat"],
    supportedViews: ["list", "chart", "tabs", "split"],
    hostActions: ["read", "aggregate"],
    limits: { maxColumns: 50, maxRows: 100, maxViews: 10 },
    safety: "Metrics without a source are shown as unbound; sample numbers are forbidden.",
    aggregateAlternative: { scope: "currentPage", label: "当前加载结果" },
  },
];

export function capabilityForScene(scene: string): BusinessCapability | undefined {
  return BUSINESS_CAPABILITY_CATALOG.find((capability) => capability.id === scene);
}

export function capabilityViewTypes(capability: BusinessCapability): CapabilityViewType[] {
  return capability.supportedViews.filter((view) => PAGE_VIEW_TYPES.includes(view));
}

export function capabilityActionTypes(capability: BusinessCapability): CapabilityAction[] {
  return capability.hostActions.filter((action) => PAGE_HOST_ACTIONS.has(action));
}

export function capabilityGap(
  capability: BusinessCapability,
  operations: readonly { method: string; path: string; role?: string }[],
): string | undefined {
  const roles = new Set(
    operations.flatMap((operation) => {
      if (operation.role) return [operation.role];
      const hasPathParameter = /\{[^}]+\}|\/:\w+/.test(operation.path);
      if (operation.method === "GET") return [hasPathParameter ? "detail" : "list"];
      if (operation.method === "POST") return ["create"];
      if (operation.method === "PUT" || operation.method === "PATCH") return ["update"];
      if (operation.method === "DELETE") return ["delete"];
      return [];
    }),
  );
  if (capability.requiredOperationRoles.includes("stat") && !roles.has("stat")) {
    return capability.aggregateAlternative
      ? `缺少具名统计 operation；只能使用${capability.aggregateAlternative.label}聚合，不能声称全量统计`
      : "缺少具名统计 operation";
  }
  const missing = capability.requiredOperationRoles.filter((role) => !roles.has(role));
  return missing.length ? `缺少所需 API 能力：${missing.join("、")}` : undefined;
}

export function capabilityPrompt(capability: BusinessCapability): string {
  return [
    `Capability ${capability.id}: ${capability.description}`,
    `Required roles: ${capability.requiredOperationRoles.join(", ")}`,
    `Supported views: ${capability.supportedViews.join(", ")}`,
    `Host actions: ${capability.hostActions.join(", ")}`,
    ...(capability.aggregateAlternative
      ? [
          `Aggregate alternative: ${capability.aggregateAlternative.label} (${capability.aggregateAlternative.scope})`,
        ]
      : []),
    `Safety: ${capability.safety}`,
  ].join("\n");
}

export function defaultPromptTemplates(): PromptTemplate[] {
  return BUSINESS_CAPABILITY_CATALOG.map((capability) => ({
    id: capability.id,
    name: capability.id,
    scene: capability.id,
    systemPrompt: capabilityPrompt(capability),
    isDefault: true,
  }));
}
