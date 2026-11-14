import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTicketsInfiniteQuery,
  type ListTicketsRequest,
} from "../../api/team/list-tickets";
export function useListTickets(input: ListTicketsRequest, viewer: Viewer) {
  return useInfiniteQuery({
    ...listTicketsInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
