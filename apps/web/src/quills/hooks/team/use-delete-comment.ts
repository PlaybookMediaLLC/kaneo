import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  deleteComment,
  type DeleteCommentRequest,
  type DeleteCommentResponse,
} from "../../api/team/delete-comment";
export function useDeleteComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DeleteCommentResponse,
    PortalProblem,
    DeleteCommentRequest
  >({
    mutationFn: (input) => deleteComment(input),
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
