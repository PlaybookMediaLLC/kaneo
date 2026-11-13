import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalRoadmapsQuery,
  type ListPortalRoadmapsRequest,
} from "../../api/feedback/list-portal-roadmaps";
export function useListPortalRoadmaps(
  input: ListPortalRoadmapsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listPortalRoadmapsQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
