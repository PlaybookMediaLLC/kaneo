import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  sendMyConversationMessage,
  type SendMyConversationMessageRequest,
  type SendMyConversationMessageResponse,
} from "../../api/support/send-my-conversation-message";
export function useSendMyConversationMessage(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SendMyConversationMessageResponse,
    PortalProblem,
    SendMyConversationMessageRequest
  >({
    mutationFn: (input) => sendMyConversationMessage(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "support",
          "getMyConversation",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "support",
          "listMyConversationMessages",
        ),
      });
    },
  });
}
