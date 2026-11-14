import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  fetchAdminOverviewQuery,
  type FetchAdminOverviewRequest,
} from "../../api/team/fetch-admin-overview";
export function useFetchAdminOverview(
  input: FetchAdminOverviewRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...fetchAdminOverviewQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
