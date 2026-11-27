import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  removeCommentPin,
  type RemoveCommentPinRequest,
  type RemoveCommentPinResponse,
} from "../../api/team/remove-comment-pin";
export function useRemoveCommentPin(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RemoveCommentPinResponse,
    PortalProblem,
    RemoveCommentPinRequest
  >({
    mutationFn: (input) => removeCommentPin(input),
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
      ]);
    },
  });
}
