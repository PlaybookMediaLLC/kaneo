import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTicketExternalLinksQuery,
  type ListTicketExternalLinksRequest,
} from "../../api/team/list-ticket-external-links";
export function useListTicketExternalLinks(
  input: ListTicketExternalLinksRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listTicketExternalLinksQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.ticketId),
  });
}
