import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  restoreComment,
  type RestoreCommentRequest,
  type RestoreCommentResponse,
} from "../../api/team/restore-comment";
export function useRestoreComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RestoreCommentResponse,
    PortalProblem,
    RestoreCommentRequest
  >({
    mutationFn: (input) => restoreComment(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPostComments",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getPost",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPosts",
          ),
        }),
      ]);
    },
  });
}
