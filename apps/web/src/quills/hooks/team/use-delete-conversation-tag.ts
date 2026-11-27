import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  deleteConversationTag,
  type DeleteConversationTagRequest,
  type DeleteConversationTagResponse,
} from "../../api/team/delete-conversation-tag";
export function useDeleteConversationTag(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DeleteConversationTagResponse,
    PortalProblem,
    DeleteConversationTagRequest
  >({
    mutationFn: (input) => deleteConversationTag(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listConversationTags",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listConversationTagUsage",
          ),
        }),
      ]);
    },
  });
}
