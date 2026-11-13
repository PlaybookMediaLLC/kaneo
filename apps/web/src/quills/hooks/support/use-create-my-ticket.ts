import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createMyTicket,
  type CreateMyTicketRequest,
  type CreateMyTicketResponse,
} from "../../api/support/create-my-ticket";
export function useCreateMyTicket(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreateMyTicketResponse,
    PortalProblem,
    CreateMyTicketRequest
  >({
    mutationFn: (input) => createMyTicket(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "support",
          "getMyTickets",
        ),
      });
    },
  });
}
