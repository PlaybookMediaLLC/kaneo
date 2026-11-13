import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicStatusUptimeQuery,
  type GetPublicStatusUptimeRequest,
} from "../../api/status/get-public-status-uptime";
export function useGetPublicStatusUptime(
  input: GetPublicStatusUptimeRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicStatusUptimeQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.query.componentIds),
  });
}
