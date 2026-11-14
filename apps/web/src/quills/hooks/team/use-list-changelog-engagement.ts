import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listChangelogEngagementInfiniteQuery,
  type ListChangelogEngagementRequest,
} from "../../api/team/list-changelog-engagement";
export function useListChangelogEngagement(
  input: ListChangelogEngagementRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listChangelogEngagementInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
