import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  draftChangelogFromPosts,
  type DraftChangelogFromPostsRequest,
  type DraftChangelogFromPostsResponse,
} from "../../api/team/draft-changelog-from-posts";
export function useDraftChangelogFromPosts(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DraftChangelogFromPostsResponse,
    PortalProblem,
    DraftChangelogFromPostsRequest
  >({
    mutationFn: (input) => draftChangelogFromPosts(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listChangelogEngagement",
        ),
      });
    },
  });
}
