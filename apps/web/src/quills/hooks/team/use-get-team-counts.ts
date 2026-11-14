import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getTeamCountsQuery,
  type GetTeamCountsRequest,
} from "../../api/team/get-team-counts";
export function useGetTeamCounts(input: GetTeamCountsRequest, viewer: Viewer) {
  return useQuery({
    ...getTeamCountsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
