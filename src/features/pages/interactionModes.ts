import type { InteractionMode, PageSpec } from "../../types/domain";

export type ResolvedInteraction = Record<"create" | "update" | "delete" | "detail", InteractionMode>;

const DEFAULT_INTERACTION: ResolvedInteraction = {
  create: "inline",
  update: "inline",
  delete: "modal",
  detail: "inline",
};

export function resolveInteraction(page: Pick<PageSpec, "interaction">): ResolvedInteraction {
  return { ...DEFAULT_INTERACTION, ...page.interaction };
}

export function usesOverlay(mode: InteractionMode): boolean {
  return mode === "modal" || mode === "drawer";
}

export function usesRedirect(mode: InteractionMode): boolean {
  return mode === "redirect";
}
