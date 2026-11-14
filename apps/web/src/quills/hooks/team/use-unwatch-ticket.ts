import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  unwatchTicket,
  type UnwatchTicketRequest,
  type UnwatchTicketResponse,
} from "../../api/team/unwatch-ticket";
export function useUnwatchTicket(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UnwatchTicketResponse,
    PortalProblem,
    UnwatchTicketRequest
  >({
    mutationFn: (input) => unwatchTicket(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getTicketWatchStatus",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listTicketWatchers",
        ),
      });
    },
  });
}
