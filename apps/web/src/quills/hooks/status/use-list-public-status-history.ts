import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import {
  listPublicStatusHistory,
  listPublicStatusHistoryKey,
  type ListPublicStatusHistoryRequest,
  type ListPublicStatusHistoryResponse,
} from "../../api/status/list-public-status-history";
export function useListPublicStatusHistory(
  input: ListPublicStatusHistoryRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery<
    ListPublicStatusHistoryResponse,
    PortalProblem,
    InfiniteData<ListPublicStatusHistoryResponse>,
    ReturnType<typeof listPublicStatusHistoryKey>,
    string | undefined
  >({
    queryKey: listPublicStatusHistoryKey(input, viewer),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      listPublicStatusHistory({
        ...input,
        query: { ...input.query, cursor: pageParam },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(input.param.workspace),
  });
}
