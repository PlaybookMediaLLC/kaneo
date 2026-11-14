import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTicketActivityQuery,
  type ListTicketActivityRequest,
} from "../../api/team/list-ticket-activity";
export function useListTicketActivity(
  input: ListTicketActivityRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listTicketActivityQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
