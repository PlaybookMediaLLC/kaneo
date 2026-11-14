import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  addConversationTag,
  type AddConversationTagRequest,
  type AddConversationTagResponse,
} from "../../api/team/add-conversation-tag";
export function useAddConversationTag(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AddConversationTagResponse,
    PortalProblem,
    AddConversationTagRequest
  >({
    mutationFn: (input) => addConversationTag(input),
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
