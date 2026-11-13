import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listMyConversationMessagesQuery,
  type ListMyConversationMessagesRequest,
} from "../../api/support/list-my-conversation-messages";
export function useListMyConversationMessages(
  input: ListMyConversationMessagesRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listMyConversationMessagesQuery(input, viewer),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    enabled: Boolean(input.param.workspace && input.param.conversationId),
  });
}
