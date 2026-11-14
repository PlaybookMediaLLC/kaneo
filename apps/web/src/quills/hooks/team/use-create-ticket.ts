import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createTicket,
  type CreateTicketRequest,
  type CreateTicketResponse,
} from "../../api/team/create-ticket";
export function useCreateTicket(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<CreateTicketResponse, PortalProblem, CreateTicketRequest>({
    mutationFn: (input) => createTicket(input),
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
          "getTeamCounts",
        ),
      });
    },
  });
}
