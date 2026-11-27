import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createPortalComment,
  type CreatePortalCommentRequest,
  type CreatePortalCommentResponse,
} from "../../api/feedback/create-portal-comment";
export function useCreatePortalComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreatePortalCommentResponse,
    PortalProblem,
    CreatePortalCommentRequest
  >({
    mutationFn: (input) => createPortalComment(input),
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
