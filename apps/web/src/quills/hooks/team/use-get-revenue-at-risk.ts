import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getRevenueAtRiskQuery,
  type GetRevenueAtRiskRequest,
} from "../../api/team/get-revenue-at-risk";
export function useGetRevenueAtRisk(
  input: GetRevenueAtRiskRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getRevenueAtRiskQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
