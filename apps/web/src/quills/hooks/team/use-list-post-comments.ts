import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPostCommentsInfiniteQuery,
  type ListPostCommentsRequest,
} from "../../api/team/list-post-comments";
export function useListPostComments(
  input: ListPostCommentsRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listPostCommentsInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.postId),
  });
}
