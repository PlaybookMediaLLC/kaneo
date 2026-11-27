import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createConversationTag,
  type CreateConversationTagRequest,
  type CreateConversationTagResponse,
} from "../../api/team/create-conversation-tag";
export function useCreateConversationTag(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreateConversationTagResponse,
    PortalProblem,
    CreateConversationTagRequest
  >({
    mutationFn: (input) => createConversationTag(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listConversationTags",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listConversationTagUsage",
          ),
        }),
      ]);
    },
  });
}
