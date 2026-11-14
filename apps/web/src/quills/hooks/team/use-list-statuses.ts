import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listStatusesQuery,
  type ListStatusesRequest,
} from "../../api/team/list-statuses";
export function useListStatuses(input: ListStatusesRequest, viewer: Viewer) {
  return useQuery({
    ...listStatusesQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
