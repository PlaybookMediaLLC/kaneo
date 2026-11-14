import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getConversationTypingQuery,
  type GetConversationTypingRequest,
} from "../../api/team/get-conversation-typing";
export function useGetConversationTyping(
  input: GetConversationTypingRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getConversationTypingQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.conversationId),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });
}
