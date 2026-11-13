import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalStatusesQuery,
  type ListPortalStatusesRequest,
} from "../../api/feedback/list-portal-statuses";
export function useListPortalStatuses(
  input: ListPortalStatusesRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listPortalStatusesQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
