/** A request owns a frozen snapshot, never a live reference to workspace state. */
export type RequestContext = Readonly<{
  projectId: string;
  apiDocumentIds: readonly string[];
  documentRevision: number;
  authorizationRevision: number;
  definitionRevision: number;
  epoch: number;
  requestId: number;
}>;

type ScopeState = Pick<
  RequestContext,
  | "projectId"
  | "apiDocumentIds"
  | "documentRevision"
  | "authorizationRevision"
  | "definitionRevision"
>;

export type RequestScope = ReturnType<typeof createRequestScope>;

export function createRequestScope(initial: Partial<ScopeState> = {}) {
  let state: ScopeState = {
    projectId: "",
    apiDocumentIds: [],
    documentRevision: 0,
    authorizationRevision: 0,
    definitionRevision: 0,
    ...initial,
  };
  let epoch = 0;
  let sequence = 0;
  const owned = new WeakSet<RequestContext>();
  const lanes = new Map<string, RequestContext>();
  const listeners = new Set<() => void>();
  function capture(): RequestContext {
    const context = Object.freeze({
      ...state,
      apiDocumentIds: Object.freeze([...state.apiDocumentIds]),
      epoch,
      requestId: ++sequence,
    });
    owned.add(context);
    return context;
  }
  function invalidate() {
    epoch++;
    lanes.clear();
    listeners.forEach((listener) => listener());
  }
  return {
    capture,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isCurrent(context: RequestContext) {
      return owned.has(context) && context.epoch === epoch;
    },
    invalidate,
    update(next: Partial<ScopeState>) {
      const merged = {
        ...state,
        ...next,
        apiDocumentIds: [...(next.apiDocumentIds ?? state.apiDocumentIds)],
      };
      if (JSON.stringify(merged) !== JSON.stringify(state)) {
        state = merged;
        invalidate();
      }
    },
    /** Latest-wins within one operation, without cancelling unrelated operations. */
    begin(channel: string) {
      const context = capture();
      lanes.set(channel, context);
      return context;
    },
    isLatest(channel: string, context: RequestContext) {
      return owned.has(context) && context.epoch === epoch && lanes.get(channel) === context;
    },
  };
}

/** Small external store used by the hooks and their injectable coordinators. */
export function createSnapshotStore<T extends object>(initial: T) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    patch(update: Partial<T>) {
      snapshot = { ...snapshot, ...update };
      listeners.forEach((listener) => listener());
    },
  };
}
