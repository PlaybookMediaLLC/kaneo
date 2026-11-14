import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getTicketWatchStatusQuery,
  type GetTicketWatchStatusRequest,
} from "../../api/team/get-ticket-watch-status";
export function useGetTicketWatchStatus(
  input: GetTicketWatchStatusRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getTicketWatchStatusQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
