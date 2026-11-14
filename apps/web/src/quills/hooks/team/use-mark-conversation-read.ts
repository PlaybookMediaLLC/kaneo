import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  markConversationRead,
  type MarkConversationReadRequest,
  type MarkConversationReadResponse,
} from "../../api/team/mark-conversation-read";
export function useMarkConversationRead(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    MarkConversationReadResponse,
    PortalProblem,
    MarkConversationReadRequest
  >({
    mutationFn: (input) => markConversationRead(input),
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
