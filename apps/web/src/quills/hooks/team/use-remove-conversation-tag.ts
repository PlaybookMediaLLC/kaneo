import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  removeConversationTag,
  type RemoveConversationTagRequest,
  type RemoveConversationTagResponse,
} from "../../api/team/remove-conversation-tag";
export function useRemoveConversationTag(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RemoveConversationTagResponse,
    PortalProblem,
    RemoveConversationTagRequest
  >({
    mutationFn: (input) => removeConversationTag(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getConversation",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listConversations",
        ),
      });
    },
  });
}
