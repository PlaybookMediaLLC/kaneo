import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getMyConversationQuery,
  type GetMyConversationRequest,
} from "../../api/support/get-my-conversation";
export function useGetMyConversation(
  input: GetMyConversationRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getMyConversationQuery(input, viewer),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    enabled: Boolean(input.param.workspace && input.param.conversationId),
  });
}
