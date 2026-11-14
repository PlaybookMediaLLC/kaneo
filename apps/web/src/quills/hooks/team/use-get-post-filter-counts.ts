import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPostFilterCountsQuery,
  type GetPostFilterCountsRequest,
} from "../../api/team/get-post-filter-counts";
export function useGetPostFilterCounts(
  input: GetPostFilterCountsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPostFilterCountsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
