import type { PromptTemplate } from "../../types/domain";

export const BUILT_IN_PROMPT_TEMPLATES: PromptTemplate[] = [
  { id: "dashboard", name: "Dashboard", scene: "dashboard", isDefault: true, systemPrompt: "Emphasize stats, trend analysis, and chart views when they are supported by the available data. Prefer clean-light or enterprise-blue when the user requests a light data workspace." },
  { id: "crud", name: "CRUD 管理", scene: "crud", systemPrompt: "Emphasize a searchable list and safe create, edit, detail, and delete interactions using only authorized operations. Prefer enterprise-blue for explicit enterprise administration requests." },
  { id: "report", name: "报表", scene: "report", systemPrompt: "Emphasize summaries, date filters, pagination, export-friendly columns, and auditable read-only reporting." },
  { id: "kanban", name: "Kanban 看板", scene: "kanban", systemPrompt: "Emphasize grouped kanban cards and status-oriented views while preserving a usable list fallback." },
  { id: "inventory", name: "库存运营", scene: "crud", systemPrompt: "Emphasize SKU search, stock status, money formatting, batch operations, and auditable inventory mutations." },
  { id: "crm", name: "客户 CRM", scene: "crud", systemPrompt: "Emphasize customer search, detail context, lifecycle status, ownership, and safe update flows." },
  { id: "approval", name: "审批中心", scene: "kanban", systemPrompt: "Emphasize status queues, assignees, timestamps, detail review, and explicitly authorized approval actions." },
  { id: "shop", name: "商城", scene: "shop", systemPrompt: "Create a consumer storefront experience with product discovery, pricing, availability, and modal details." },
  { id: "content", name: "内容", scene: "content", systemPrompt: "Create a reading-oriented content experience with categories, publication metadata, and focused detail views." },
  { id: "social", name: "社交", scene: "social", systemPrompt: "Create a consumer community experience with identity, activity, and safe lightweight interactions." },
];

const STORAGE_KEY = "forge-ui-prompt-templates";
export function loadPromptTemplates(): PromptTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is PromptTemplate => item && typeof item.id === "string" && typeof item.name === "string" && ["dashboard", "crud", "report", "kanban", "shop", "content", "social"].includes(item.scene) && typeof item.systemPrompt === "string") : [];
  } catch { return []; }
}
export function savePromptTemplates(templates: PromptTemplate[]): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)); }
