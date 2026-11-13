import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalRoadmapPostsQuery,
  type ListPortalRoadmapPostsRequest,
} from "../../api/feedback/list-portal-roadmap-posts";
export function useListPortalRoadmapPosts(
  input: ListPortalRoadmapPostsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listPortalRoadmapPostsQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.roadmapId),
  });
}
