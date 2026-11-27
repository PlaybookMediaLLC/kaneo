import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  restorePost,
  type RestorePostRequest,
  type RestorePostResponse,
} from "../../api/team/restore-post";
export function useRestorePost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<RestorePostResponse, PortalProblem, RestorePostRequest>({
    mutationFn: (input) => restorePost(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPosts",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getTeamCounts",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getPostFilterCounts",
          ),
        }),
      ]);
    },
  });
}
