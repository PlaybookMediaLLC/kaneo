import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  watchTicket,
  type WatchTicketRequest,
  type WatchTicketResponse,
} from "../../api/team/watch-ticket";
export function useWatchTicket(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<WatchTicketResponse, PortalProblem, WatchTicketRequest>({
    mutationFn: (input) => watchTicket(input),
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
