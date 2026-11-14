import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPortalUserStatsQuery,
  type GetPortalUserStatsRequest,
} from "../../api/feedback/get-portal-user-stats";
export function useGetPortalUserStats(
  input: GetPortalUserStatsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPortalUserStatsQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
