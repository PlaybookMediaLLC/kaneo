import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTicketConversationsQuery,
  type ListTicketConversationsRequest,
} from "../../api/team/list-ticket-conversations";
export function useListTicketConversations(
  input: ListTicketConversationsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listTicketConversationsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
