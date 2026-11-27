import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  deletePortalOwnComment,
  type DeletePortalOwnCommentRequest,
  type DeletePortalOwnCommentResponse,
} from "../../api/feedback/delete-portal-own-comment";
export function useDeletePortalOwnComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DeletePortalOwnCommentResponse,
    PortalProblem,
    DeletePortalOwnCommentRequest
  >({
    mutationFn: (input) => deletePortalOwnComment(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspace,
            viewer,
            "feedback",
            "listPortalPostComments",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspace,
            viewer,
            "feedback",
            "listPortalPosts",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspace,
            viewer,
            "feedback",
            "getPortalPost",
          ),
        }),
      ]);
    },
  });
}
