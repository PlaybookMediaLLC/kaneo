import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createPostFromConversation,
  type CreatePostFromConversationRequest,
  type CreatePostFromConversationResponse,
} from "../../api/team/create-post-from-conversation";
export function useCreatePostFromConversation(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreatePostFromConversationResponse,
    PortalProblem,
    CreatePostFromConversationRequest
  >({
    mutationFn: (input) => createPostFromConversation(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getLinkedPostsForConversation",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listConversationMessages",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getConversation",
          ),
        }),
      ]);
    },
  });
}
