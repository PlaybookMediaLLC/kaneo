import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listSegmentsQuery,
  type ListSegmentsRequest,
} from "../../api/team/list-segments";
export function useListSegments(input: ListSegmentsRequest, viewer: Viewer) {
  return useQuery({
    ...listSegmentsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
