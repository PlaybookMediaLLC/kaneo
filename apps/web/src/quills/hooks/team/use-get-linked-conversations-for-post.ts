import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getLinkedConversationsForPostQuery,
  type GetLinkedConversationsForPostRequest,
} from "../../api/team/get-linked-conversations-for-post";
export function useGetLinkedConversationsForPost(
  input: GetLinkedConversationsForPostRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getLinkedConversationsForPostQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.postId),
  });
}
