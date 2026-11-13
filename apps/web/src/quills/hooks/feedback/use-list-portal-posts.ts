import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalPostsInfiniteQuery,
  type ListPortalPostsRequest,
} from "../../api/feedback/list-portal-posts";
export function useListPortalPosts(
  input: ListPortalPostsRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listPortalPostsInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
