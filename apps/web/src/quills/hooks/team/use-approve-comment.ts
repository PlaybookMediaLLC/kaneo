import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  approveComment,
  type ApproveCommentRequest,
  type ApproveCommentResponse,
} from "../../api/team/approve-comment";
export function useApproveComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    ApproveCommentResponse,
    PortalProblem,
    ApproveCommentRequest
  >({
    mutationFn: (input) => approveComment(input),
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
