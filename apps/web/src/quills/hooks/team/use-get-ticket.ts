import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getTicketQuery,
  type GetTicketRequest,
} from "../../api/team/get-ticket";
export function useGetTicket(input: GetTicketRequest, viewer: Viewer) {
  return useQuery({
    ...getTicketQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
