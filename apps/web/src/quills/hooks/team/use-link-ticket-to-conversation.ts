import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  linkTicketToConversation,
  type LinkTicketToConversationRequest,
  type LinkTicketToConversationResponse,
} from "../../api/team/link-ticket-to-conversation";
export function useLinkTicketToConversation(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    LinkTicketToConversationResponse,
    PortalProblem,
    LinkTicketToConversationRequest
  >({
    mutationFn: (input) => linkTicketToConversation(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getConversationTicketLink",
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
      ]);
    },
  });
}
