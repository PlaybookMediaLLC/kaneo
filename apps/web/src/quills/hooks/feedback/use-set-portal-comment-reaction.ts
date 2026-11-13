import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPortalCommentReaction,
  type SetPortalCommentReactionRequest,
  type SetPortalCommentReactionResponse,
} from "../../api/feedback/set-portal-comment-reaction";
export function useSetPortalCommentReaction(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetPortalCommentReactionResponse,
    PortalProblem,
    SetPortalCommentReactionRequest
  >({
    mutationFn: (input) => setPortalCommentReaction(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "feedback",
          "listPortalPostComments",
        ),
      });
    },
  });
}
