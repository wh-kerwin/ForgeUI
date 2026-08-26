import { useEffect } from "react";
import type { BusinessAuth, OpenApiSummary } from "../../types/domain";
import { useWorkbenchStore } from "../../store/workbenchStore";

type Options = { spec: OpenApiSummary | null; auth: BusinessAuth; onNotice: (message: string) => void; };

export function useGeneratedPageActions({ spec, auth, onNotice }: Options) {
  const page = useWorkbenchStore((state) => state.page);
  const setPage = useWorkbenchStore((state) => state.setPage);
  const detail = useWorkbenchStore((state) => state.detail);
  const querying = useWorkbenchStore((state) => state.querying);
  const configureApi = useWorkbenchStore((state) => state.configureApi);
  const cancelPendingQuery = useWorkbenchStore((state) => state.cancelPendingQuery);
  const query = useWorkbenchStore((state) => state.query);
  const loadDetail = useWorkbenchStore((state) => state.loadDetail);
  const mutate = useWorkbenchStore((state) => state.mutate);
  const deleteRecord = useWorkbenchStore((state) => state.deleteRecord);

  useEffect(() => {
    configureApi({ spec, auth, onNotice });
    return cancelPendingQuery;
  }, [auth, cancelPendingQuery, configureApi, onNotice, spec]);

  return { page, setPage, detail, querying, query, loadDetail, mutate, deleteRecord };
}
