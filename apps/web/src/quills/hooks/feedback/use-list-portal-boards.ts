import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalBoardsQuery,
  type ListPortalBoardsRequest,
} from "../../api/feedback/list-portal-boards";
export function useListPortalBoards(
  input: ListPortalBoardsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listPortalBoardsQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
