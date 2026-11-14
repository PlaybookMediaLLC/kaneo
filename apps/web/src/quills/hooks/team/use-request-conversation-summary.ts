import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  requestConversationSummary,
  type RequestConversationSummaryRequest,
  type RequestConversationSummaryResponse,
} from "../../api/team/request-conversation-summary";
export function useRequestConversationSummary(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RequestConversationSummaryResponse,
    PortalProblem,
    RequestConversationSummaryRequest
  >({
    mutationFn: (input) => requestConversationSummary(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getConversation",
        ),
      });
    },
  });
}
