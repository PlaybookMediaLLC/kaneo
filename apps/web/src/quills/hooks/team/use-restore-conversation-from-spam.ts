import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  restoreConversationFromSpam,
  type RestoreConversationFromSpamRequest,
  type RestoreConversationFromSpamResponse,
} from "../../api/team/restore-conversation-from-spam";
export function useRestoreConversationFromSpam(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RestoreConversationFromSpamResponse,
    PortalProblem,
    RestoreConversationFromSpamRequest
  >({
    mutationFn: (input) => restoreConversationFromSpam(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listConversations",
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
            "getTeamCounts",
          ),
        }),
      ]);
    },
  });
}
