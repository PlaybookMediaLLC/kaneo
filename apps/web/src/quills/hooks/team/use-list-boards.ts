import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listBoardsQuery,
  type ListBoardsRequest,
} from "../../api/team/list-boards";
export function useListBoards(input: ListBoardsRequest, viewer: Viewer) {
  return useQuery({
    ...listBoardsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
