import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setCommentPin,
  type SetCommentPinRequest,
  type SetCommentPinResponse,
} from "../../api/team/set-comment-pin";
export function useSetCommentPin(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetCommentPinResponse,
    PortalProblem,
    SetCommentPinRequest
  >({
    mutationFn: (input) => setCommentPin(input),
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
