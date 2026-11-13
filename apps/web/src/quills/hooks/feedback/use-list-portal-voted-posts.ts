import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalVotedPostsQuery,
  type ListPortalVotedPostsRequest,
} from "../../api/feedback/list-portal-voted-posts";
export function useListPortalVotedPosts(
  input: ListPortalVotedPostsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listPortalVotedPostsQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
