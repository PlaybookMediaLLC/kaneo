import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  sendConversationTyping,
  type SendConversationTypingRequest,
  type SendConversationTypingResponse,
} from "../../api/team/send-conversation-typing";
export function useSendConversationTyping(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SendConversationTypingResponse,
    PortalProblem,
    SendConversationTypingRequest
  >({
    mutationFn: (input) => sendConversationTyping(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getConversationTyping",
        ),
      });
    },
  });
}
