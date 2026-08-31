import { useEffect } from "react";
import type { ApiDocument } from "../../types/domain";
import { useWorkbenchStore } from "../../store/workbenchStore";

type Options = {
  projectId: string;
  apiDocuments: ApiDocument[];
  onNotice: (message: string) => void;
};

export function useGeneratedPageActions({ projectId, apiDocuments, onNotice }: Options) {
  const page = useWorkbenchStore((state) => state.page);
  const setPage = useWorkbenchStore((state) => state.setPage);
  const detail = useWorkbenchStore((state) => state.detail);
  const querying = useWorkbenchStore((state) => state.querying);
  const queryMeta = useWorkbenchStore((state) => state.queryMeta);
  const configureApi = useWorkbenchStore((state) => state.configureApi);
  const cancelPendingQuery = useWorkbenchStore((state) => state.cancelPendingQuery);
  const query = useWorkbenchStore((state) => state.query);
  const loadDetail = useWorkbenchStore((state) => state.loadDetail);
  const mutate = useWorkbenchStore((state) => state.mutate);
  const deleteRecord = useWorkbenchStore((state) => state.deleteRecord);

  useEffect(() => {
    configureApi({ projectId, apiDocuments, onNotice });
    return cancelPendingQuery;
  }, [apiDocuments, cancelPendingQuery, configureApi, onNotice, projectId]);

  return { page, setPage, detail, querying, queryMeta, query, loadDetail, mutate, deleteRecord };
}
