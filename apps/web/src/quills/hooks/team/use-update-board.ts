import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  updateBoard,
  type UpdateBoardRequest,
  type UpdateBoardResponse,
} from "../../api/team/update-board";
export function useUpdateBoard(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<UpdateBoardResponse, PortalProblem, UpdateBoardRequest>({
    mutationFn: (input) => updateBoard(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listBoards",
        ),
      });
    },
  });
}
