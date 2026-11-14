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
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listTickets",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getTicket",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listTicketActivity",
        ),
      });
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
