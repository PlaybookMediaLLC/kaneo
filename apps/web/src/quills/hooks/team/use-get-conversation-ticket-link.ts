import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getConversationTicketLinkQuery,
  type GetConversationTicketLinkRequest,
} from "../../api/team/get-conversation-ticket-link";
export function useGetConversationTicketLink(
  input: GetConversationTicketLinkRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getConversationTicketLinkQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.conversationId),
  });
}
