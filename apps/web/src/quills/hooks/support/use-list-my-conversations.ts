import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import {
  listMyConversations,
  listMyConversationsKey,
  type ListMyConversationsRequest,
  type ListMyConversationsResponse,
} from "../../api/support/list-my-conversations";
export function useListMyConversations(
  input: ListMyConversationsRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery<
    ListMyConversationsResponse,
    PortalProblem,
    InfiniteData<ListMyConversationsResponse>,
    ReturnType<typeof listMyConversationsKey>,
    string | undefined
  >({
    queryKey: listMyConversationsKey(input, viewer),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      listMyConversations({
        ...input,
        query: { ...input.query, cursor: pageParam },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(input.param.workspace),
  });
}
