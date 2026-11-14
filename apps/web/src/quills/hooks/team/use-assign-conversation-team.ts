import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  assignConversationTeam,
  type AssignConversationTeamRequest,
  type AssignConversationTeamResponse,
} from "../../api/team/assign-conversation-team";
export function useAssignConversationTeam(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AssignConversationTeamResponse,
    PortalProblem,
    AssignConversationTeamRequest
  >({
    mutationFn: (input) => assignConversationTeam(input),
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
          "listConversationMessages",
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
