import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicStatusIncidentQuery,
  type GetPublicStatusIncidentRequest,
} from "../../api/status/get-public-status-incident";
export function useGetPublicStatusIncident(
  input: GetPublicStatusIncidentRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicStatusIncidentQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.incidentId),
  });
}
