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
    onSuccess: (_data, input) => {
      // The reply carries the comment's reactions, so the page shows them at once and the
      // refresh runs in the background. ponytail: it refetches every loaded comment page;
      // patch the cached page with setQueryData if long threads make this costly.
      void queryClient.invalidateQueries({
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
