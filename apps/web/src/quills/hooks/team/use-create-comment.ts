import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createComment,
  type CreateCommentRequest,
  type CreateCommentResponse,
} from "../../api/team/create-comment";
export function useCreateComment(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreateCommentResponse,
    PortalProblem,
    CreateCommentRequest
  >({
    mutationFn: (input) => createComment(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listPosts",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getPost",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getTeamCounts",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listPostComments",
        ),
      });
    },
  });
}
