import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  updateBoardSettings,
  type UpdateBoardSettingsRequest,
  type UpdateBoardSettingsResponse,
} from "../../api/team/update-board-settings";
export function useUpdateBoardSettings(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateBoardSettingsResponse,
    PortalProblem,
    UpdateBoardSettingsRequest
  >({
    mutationFn: (input) => updateBoardSettings(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getBoardSettings",
        ),
      });
    },
  });
}
