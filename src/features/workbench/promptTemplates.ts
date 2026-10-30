import type { PromptTemplate } from "../../types/domain";
import { defaultPromptTemplates } from "../pages/capabilities/businessCapabilityCatalog";

export const BUILT_IN_PROMPT_TEMPLATES: PromptTemplate[] = defaultPromptTemplates();

const STORAGE_KEY = "forge-ui-prompt-templates";
export function loadPromptTemplates(): PromptTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is PromptTemplate =>
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            [
              "query",
              "dashboard",
              "crud",
              "report",
              "kanban",
              "shop",
              "content",
              "social",
            ].includes(item.scene) &&
            typeof item.systemPrompt === "string",
        )
      : [];
  } catch {
    return [];
  }
}
export function savePromptTemplates(templates: PromptTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}
