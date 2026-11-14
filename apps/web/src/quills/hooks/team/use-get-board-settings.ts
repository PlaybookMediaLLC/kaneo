import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getBoardSettingsQuery,
  type GetBoardSettingsRequest,
} from "../../api/team/get-board-settings";
export function useGetBoardSettings(
  input: GetBoardSettingsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getBoardSettingsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.boardId),
  });
}
