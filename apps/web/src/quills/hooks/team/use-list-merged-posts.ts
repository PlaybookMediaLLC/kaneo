import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listMergedPostsQuery,
  type ListMergedPostsRequest,
} from "../../api/team/list-merged-posts";
export function useListMergedPosts(
  input: ListMergedPostsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listMergedPostsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.postId),
  });
}
