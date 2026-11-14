import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  muteTicket,
  type MuteTicketRequest,
  type MuteTicketResponse,
} from "../../api/team/mute-ticket";
export function useMuteTicket(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<MuteTicketResponse, PortalProblem, MuteTicketRequest>({
    mutationFn: (input) => muteTicket(input),
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
