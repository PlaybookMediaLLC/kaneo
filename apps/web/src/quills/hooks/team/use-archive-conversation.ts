import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  archiveConversation,
  type ArchiveConversationRequest,
  type ArchiveConversationResponse,
} from "../../api/team/archive-conversation";
export function useArchiveConversation(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    ArchiveConversationResponse,
    PortalProblem,
    ArchiveConversationRequest
  >({
    mutationFn: (input) => archiveConversation(input),
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
            "getTeamCounts",
          ),
        }),
      ]);
    },
  });
}
