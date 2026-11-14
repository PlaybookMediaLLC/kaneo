import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import { listTagsQuery, type ListTagsRequest } from "../../api/team/list-tags";
export function useListTags(input: ListTagsRequest, viewer: Viewer) {
  return useQuery({
    ...listTagsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
