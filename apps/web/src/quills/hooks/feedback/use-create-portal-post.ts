import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createPortalPost,
  type CreatePortalPostRequest,
  type CreatePortalPostResponse,
} from "../../api/feedback/create-portal-post";
export function useCreatePortalPost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreatePortalPostResponse,
    PortalProblem,
    CreatePortalPostRequest
  >({
    mutationFn: (input) => createPortalPost(input),
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
    },
  });
}
