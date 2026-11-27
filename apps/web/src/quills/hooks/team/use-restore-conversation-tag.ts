import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  restoreConversationTag,
  type RestoreConversationTagRequest,
  type RestoreConversationTagResponse,
} from "../../api/team/restore-conversation-tag";
export function useRestoreConversationTag(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RestoreConversationTagResponse,
    PortalProblem,
    RestoreConversationTagRequest
  >({
    mutationFn: (input) => restoreConversationTag(input),
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
