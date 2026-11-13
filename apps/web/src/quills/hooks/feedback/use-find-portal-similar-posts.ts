import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  findPortalSimilarPostsQuery,
  type FindPortalSimilarPostsRequest,
} from "../../api/feedback/find-portal-similar-posts";
export function useFindPortalSimilarPosts(
  input: FindPortalSimilarPostsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...findPortalSimilarPostsQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.query.title),
  });
}
