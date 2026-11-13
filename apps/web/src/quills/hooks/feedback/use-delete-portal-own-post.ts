import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  deletePortalOwnPost,
  type DeletePortalOwnPostRequest,
  type DeletePortalOwnPostResponse,
} from "../../api/feedback/delete-portal-own-post";
export function useDeletePortalOwnPost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DeletePortalOwnPostResponse,
    PortalProblem,
    DeletePortalOwnPostRequest
  >({
    mutationFn: (input) => deletePortalOwnPost(input),
    onSuccess: async (_data, input) => {
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
          "listPortalBoards",
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
