import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getTicketSummaryQuery,
  type GetTicketSummaryRequest,
} from "../../api/team/get-ticket-summary";
export function useGetTicketSummary(
  input: GetTicketSummaryRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getTicketSummaryQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
