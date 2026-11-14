import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPostsInfiniteQuery,
  type ListPostsRequest,
} from "../../api/team/list-posts";
export function useListPosts(input: ListPostsRequest, viewer: Viewer) {
  return useInfiniteQuery({
    ...listPostsInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
