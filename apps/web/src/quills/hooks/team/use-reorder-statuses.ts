import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  reorderStatuses,
  type ReorderStatusesRequest,
  type ReorderStatusesResponse,
} from "../../api/team/reorder-statuses";
export function useReorderStatuses(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    ReorderStatusesResponse,
    PortalProblem,
    ReorderStatusesRequest
  >({
    mutationFn: (input) => reorderStatuses(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listStatuses",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getTeamCounts",
          ),
        }),
      ]);
    },
  });
}
