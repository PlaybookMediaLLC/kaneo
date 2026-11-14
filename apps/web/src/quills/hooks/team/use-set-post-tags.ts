import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPostTags,
  type SetPostTagsRequest,
  type SetPostTagsResponse,
} from "../../api/team/set-post-tags";
export function useSetPostTags(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<SetPostTagsResponse, PortalProblem, SetPostTagsRequest>({
    mutationFn: (input) => setPostTags(input),
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
