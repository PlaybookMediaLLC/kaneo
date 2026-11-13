import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  markMyConversationRead,
  type MarkMyConversationReadRequest,
  type MarkMyConversationReadResponse,
} from "../../api/support/mark-my-conversation-read";
export function useMarkMyConversationRead(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    MarkMyConversationReadResponse,
    PortalProblem,
    MarkMyConversationReadRequest
  >({
    mutationFn: (input) => markMyConversationRead(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "support",
          "getMyConversation",
        ),
      });
    },
  });
}
