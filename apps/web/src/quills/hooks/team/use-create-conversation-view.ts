import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createConversationView,
  type CreateConversationViewRequest,
  type CreateConversationViewResponse,
} from "../../api/team/create-conversation-view";
export function useCreateConversationView(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreateConversationViewResponse,
    PortalProblem,
    CreateConversationViewRequest
  >({
    mutationFn: (input) => createConversationView(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listConversationViews",
        ),
      });
    },
  });
}
