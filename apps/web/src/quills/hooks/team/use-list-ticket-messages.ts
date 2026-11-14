import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTicketMessagesQuery,
  type ListTicketMessagesRequest,
} from "../../api/team/list-ticket-messages";
export function useListTicketMessages(
  input: ListTicketMessagesRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listTicketMessagesQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
