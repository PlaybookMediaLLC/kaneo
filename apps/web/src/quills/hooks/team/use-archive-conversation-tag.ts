import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  archiveConversationTag,
  type ArchiveConversationTagRequest,
  type ArchiveConversationTagResponse,
} from "../../api/team/archive-conversation-tag";
export function useArchiveConversationTag(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    ArchiveConversationTagResponse,
    PortalProblem,
    ArchiveConversationTagRequest
  >({
    mutationFn: (input) => archiveConversationTag(input),
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
