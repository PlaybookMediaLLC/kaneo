import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  searchShippedPostsQuery,
  type SearchShippedPostsRequest,
} from "../../api/team/search-shipped-posts";
export function useSearchShippedPosts(
  input: SearchShippedPostsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...searchShippedPostsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
