import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  endConversation,
  type EndConversationRequest,
  type EndConversationResponse,
} from "../../api/team/end-conversation";
export function useEndConversation(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    EndConversationResponse,
    PortalProblem,
    EndConversationRequest
  >({
    mutationFn: (input) => endConversation(input),
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
