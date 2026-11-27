import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  unarchiveConversation,
  type UnarchiveConversationRequest,
  type UnarchiveConversationResponse,
} from "../../api/team/unarchive-conversation";
export function useUnarchiveConversation(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UnarchiveConversationResponse,
    PortalProblem,
    UnarchiveConversationRequest
  >({
    mutationFn: (input) => unarchiveConversation(input),
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
