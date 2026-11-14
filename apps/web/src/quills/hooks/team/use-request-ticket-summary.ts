import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  requestTicketSummary,
  type RequestTicketSummaryRequest,
  type RequestTicketSummaryResponse,
} from "../../api/team/request-ticket-summary";
export function useRequestTicketSummary(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RequestTicketSummaryResponse,
    PortalProblem,
    RequestTicketSummaryRequest
  >({
    mutationFn: (input) => requestTicketSummary(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getTicketSummary",
        ),
      });
    },
  });
}
