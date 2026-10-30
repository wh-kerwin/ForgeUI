import { PAGE_RENDERER_REGISTRY } from "./pageRendererRegistry";
import type { PageView } from "../../types/domain";

export type HostAction = "read" | "create" | "update" | "delete" | "export" | "aggregate";
export const PAGE_HOST_ACTIONS: ReadonlySet<HostAction> = new Set([
  "read",
  "create",
  "update",
  "delete",
  "export",
  "aggregate",
]);

export const PAGE_VIEW_RENDERERS = PAGE_RENDERER_REGISTRY;
export const PAGE_VIEW_TYPES = Object.keys(PAGE_VIEW_RENDERERS) as PageView["type"][];
