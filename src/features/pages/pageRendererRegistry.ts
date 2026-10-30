import type { PageView } from "../../types/domain";
import type { HostAction } from "../pages/viewCapabilities";

type RendererDescriptor = { readonly hostActions: readonly HostAction[] };

export const PAGE_RENDERER_REGISTRY: Readonly<Record<PageView["type"], RendererDescriptor>> = {
  list: { hostActions: ["read", "create", "update", "delete", "export"] },
  chart: { hostActions: ["read", "export"] },
  kanban: { hostActions: ["read", "update"] },
  tabs: { hostActions: ["read", "create", "update", "delete", "export", "aggregate"] },
  split: { hostActions: ["read", "create", "update", "delete", "export", "aggregate"] },
};
