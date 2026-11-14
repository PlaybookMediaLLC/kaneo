import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  markTicketRead,
  type MarkTicketReadRequest,
  type MarkTicketReadResponse,
} from "../../api/team/mark-ticket-read";
export function useMarkTicketRead(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    MarkTicketReadResponse,
    PortalProblem,
    MarkTicketReadRequest
  >({
    mutationFn: (input) => markTicketRead(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getTeamCounts",
        ),
      });
    },
  });
}
