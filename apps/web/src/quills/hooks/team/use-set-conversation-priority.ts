import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setConversationPriority,
  type SetConversationPriorityRequest,
  type SetConversationPriorityResponse,
} from "../../api/team/set-conversation-priority";
export function useSetConversationPriority(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetConversationPriorityResponse,
    PortalProblem,
    SetConversationPriorityRequest
  >({
    mutationFn: (input) => setConversationPriority(input),
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
