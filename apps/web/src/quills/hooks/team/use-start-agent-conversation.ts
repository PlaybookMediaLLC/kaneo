import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  startAgentConversation,
  type StartAgentConversationRequest,
  type StartAgentConversationResponse,
} from "../../api/team/start-agent-conversation";
export function useStartAgentConversation(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    StartAgentConversationResponse,
    PortalProblem,
    StartAgentConversationRequest
  >({
    mutationFn: (input) => startAgentConversation(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listConversations",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getTeamCounts",
        ),
      });
    },
  });
}
