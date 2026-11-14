import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  unmuteTicket,
  type UnmuteTicketRequest,
  type UnmuteTicketResponse,
} from "../../api/team/unmute-ticket";
export function useUnmuteTicket(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<UnmuteTicketResponse, PortalProblem, UnmuteTicketRequest>({
    mutationFn: (input) => unmuteTicket(input),
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
