import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  startMyConversation,
  type StartMyConversationRequest,
  type StartMyConversationResponse,
} from "../../api/support/start-my-conversation";
export function useStartMyConversation(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    StartMyConversationResponse,
    PortalProblem,
    StartMyConversationRequest
  >({
    mutationFn: (input) => startMyConversation(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "support",
          "listMyConversations",
        ),
      });
    },
  });
}
