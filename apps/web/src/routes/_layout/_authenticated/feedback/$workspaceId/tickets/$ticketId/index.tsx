import { createFileRoute } from "@tanstack/react-router";
import { TeamTicketsPage } from "@/quills/pages/team-tickets/team-tickets-page";
import { ticketSearch } from "@/quills/pages/team-tickets/ticket-scope";
// An open ticket: the same two-pane page as the list, with the ticket in the main pane.
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/tickets/$ticketId/",
)({ validateSearch: ticketSearch, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamTicketsPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
