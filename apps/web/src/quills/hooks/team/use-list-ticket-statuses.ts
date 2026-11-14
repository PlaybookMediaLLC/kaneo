import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTicketStatusesQuery,
  type ListTicketStatusesRequest,
} from "../../api/team/list-ticket-statuses";
export function useListTicketStatuses(
  input: ListTicketStatusesRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listTicketStatusesQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
