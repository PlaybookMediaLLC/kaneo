import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getTicketLinksQuery,
  type GetTicketLinksRequest,
} from "../../api/team/get-ticket-links";
export function useGetTicketLinks(
  input: GetTicketLinksRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getTicketLinksQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
