import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createPost,
  type CreatePostRequest,
  type CreatePostResponse,
} from "../../api/team/create-post";
export function useCreatePost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<CreatePostResponse, PortalProblem, CreatePostRequest>({
    mutationFn: (input) => createPost(input),
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
          "getTeamCounts",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getPostFilterCounts",
        ),
      });
    },
  });
}
