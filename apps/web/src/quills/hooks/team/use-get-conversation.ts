import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getConversationQuery,
  type GetConversationRequest,
} from "../../api/team/get-conversation";
export function useGetConversation(
  input: GetConversationRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getConversationQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.conversationId),
  });
}
