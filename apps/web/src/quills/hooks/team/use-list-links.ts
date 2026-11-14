import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listLinksQuery,
  type ListLinksRequest,
} from "../../api/team/list-links";
export function useListLinks(input: ListLinksRequest, viewer: Viewer) {
  return useQuery({
    ...listLinksQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
