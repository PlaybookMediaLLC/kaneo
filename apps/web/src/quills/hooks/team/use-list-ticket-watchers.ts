import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTicketWatchersQuery,
  type ListTicketWatchersRequest,
} from "../../api/team/list-ticket-watchers";
export function useListTicketWatchers(
  input: ListTicketWatchersRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listTicketWatchersQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
