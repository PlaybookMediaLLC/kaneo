import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  rejectComment,
  type RejectCommentRequest,
  type RejectCommentResponse,
} from "../../api/team/reject-comment";
export function useRejectComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RejectCommentResponse,
    PortalProblem,
    RejectCommentRequest
  >({
    mutationFn: (input) => rejectComment(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPendingModeration",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getModerationStatus",
          ),
        }),
      ]);
    },
  });
}
