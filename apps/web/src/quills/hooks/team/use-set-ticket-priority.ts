import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setTicketPriority,
  type SetTicketPriorityRequest,
  type SetTicketPriorityResponse,
} from "../../api/team/set-ticket-priority";
export function useSetTicketPriority(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetTicketPriorityResponse,
    PortalProblem,
    SetTicketPriorityRequest
  >({
    mutationFn: (input) => setTicketPriority(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listTickets",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getTicket",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listTicketActivity",
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
