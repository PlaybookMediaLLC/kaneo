import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  editPortalOwnPost,
  type EditPortalOwnPostRequest,
  type EditPortalOwnPostResponse,
} from "../../api/feedback/edit-portal-own-post";
export function useEditPortalOwnPost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    EditPortalOwnPostResponse,
    PortalProblem,
    EditPortalOwnPostRequest
  >({
    mutationFn: (input) => editPortalOwnPost(input),
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
          "getPortalPost",
        ),
      });
    },
  });
}
