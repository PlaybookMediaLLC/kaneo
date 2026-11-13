import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  editPortalOwnComment,
  type EditPortalOwnCommentRequest,
  type EditPortalOwnCommentResponse,
} from "../../api/feedback/edit-portal-own-comment";
export function useEditPortalOwnComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    EditPortalOwnCommentResponse,
    PortalProblem,
    EditPortalOwnCommentRequest
  >({
    mutationFn: (input) => editPortalOwnComment(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "feedback",
          "listPortalPostComments",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "feedback",
          "listPortalPosts",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "feedback",
          "getPortalPost",
        ),
      });
    },
  });
}
