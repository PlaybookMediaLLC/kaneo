import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getLinkedPostsForConversationQuery,
  type GetLinkedPostsForConversationRequest,
} from "../../api/team/get-linked-posts-for-conversation";
export function useGetLinkedPostsForConversation(
  input: GetLinkedPostsForConversationRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getLinkedPostsForConversationQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.conversationId),
  });
}
