import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import {
  getMyTickets,
  getMyTicketsKey,
  type GetMyTicketsRequest,
  type GetMyTicketsResponse,
} from "../../api/support/get-my-tickets";
export function useGetMyTickets(input: GetMyTicketsRequest, viewer: Viewer) {
  return useInfiniteQuery<
    GetMyTicketsResponse,
    PortalProblem,
    InfiniteData<GetMyTicketsResponse>,
    ReturnType<typeof getMyTicketsKey>,
    string | undefined
  >({
    queryKey: getMyTicketsKey(input, viewer),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      getMyTickets({ ...input, query: { ...input.query, cursor: pageParam } }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(input.param.workspace),
  });
}
