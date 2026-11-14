import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listConversationMessagesQuery,
  type ListConversationMessagesRequest,
} from "../../api/team/list-conversation-messages";
export function useListConversationMessages(
  input: ListConversationMessagesRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listConversationMessagesQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.conversationId),
  });
}
