import { useLayoutEffect } from "react";
import type { RequestScope } from "./requestContext";
import type { ApiDocument } from "../../types/domain";
import { useWorkbenchStore } from "../../store/workbenchStore";

type Options = {
  projectId: string;
  apiDocuments: ApiDocument[];
  onNotice: (message: string) => void;
  requestScope?: RequestScope;
};

export function useGeneratedPageActions({
  projectId,
  apiDocuments,
  onNotice,
  requestScope,
}: Options) {
  const page = useWorkbenchStore((state) => state.page);
  const setPage = useWorkbenchStore((state) => state.setPage);
  const detail = useWorkbenchStore((state) => state.detail);
  const querying = useWorkbenchStore((state) => state.querying);
  const queryMeta = useWorkbenchStore((state) => state.queryMeta);
  const runtime = useWorkbenchStore((state) => state.runtime);
  const setRuntimeSelection = useWorkbenchStore((state) => state.setRuntimeSelection);
  const setRuntimeControls = useWorkbenchStore((state) => state.setRuntimeControls);
  const configureApi = useWorkbenchStore((state) => state.configureApi);
  const cancelPendingQuery = useWorkbenchStore((state) => state.cancelPendingQuery);
  const query = useWorkbenchStore((state) => state.query);
  const loadDetail = useWorkbenchStore((state) => state.loadDetail);
  const mutate = useWorkbenchStore((state) => state.mutate);
  const deleteRecord = useWorkbenchStore((state) => state.deleteRecord);

  useLayoutEffect(() => {
    configureApi({ projectId, apiDocuments, onNotice, requestScope });
    return cancelPendingQuery;
  }, [apiDocuments, cancelPendingQuery, configureApi, onNotice, projectId, requestScope]);

  return {
    page,
    setPage,
    detail,
    querying,
    queryMeta,
    runtime,
    setRuntimeSelection,
    setRuntimeControls,
    query,
    loadDetail,
    mutate,
    deleteRecord,
  };
}
