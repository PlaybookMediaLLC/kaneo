import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPostStatus,
  type SetPostStatusRequest,
  type SetPostStatusResponse,
} from "../../api/team/set-post-status";
export function useSetPostStatus(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetPostStatusResponse,
    PortalProblem,
    SetPostStatusRequest
  >({
    mutationFn: (input) => setPostStatus(input),
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
          "getPostFilterCounts",
        ),
      });
    },
  });
}
