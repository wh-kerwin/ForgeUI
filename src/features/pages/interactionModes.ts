import type { InteractionMode, PageSpec } from "../../types/domain";

export type ResolvedInteraction = Record<
  "create" | "update" | "delete" | "detail",
  InteractionMode
>;

const DEFAULT_INTERACTION: ResolvedInteraction = {
  create: "inline",
  update: "inline",
  delete: "modal",
  detail: "inline",
};

const CRUD_MODAL_INTERACTION: ResolvedInteraction = {
  create: "modal",
  update: "modal",
  delete: "modal",
  detail: "modal",
};

export function resolveInteraction(
  page: Pick<PageSpec, "interaction">,
  isCrudPage = false,
): ResolvedInteraction {
  if (isCrudPage) return CRUD_MODAL_INTERACTION;
  return { ...DEFAULT_INTERACTION, ...page.interaction };
}

export function usesOverlay(mode: InteractionMode): boolean {
  return mode === "modal" || mode === "drawer";
}

export function usesRedirect(mode: InteractionMode): boolean {
  return mode === "redirect";
}
