import { createFileRoute } from "@tanstack/react-router";
import { TeamTicketsPage } from "@/quills/pages/team-tickets/team-tickets-page";
import { ticketSearch } from "@/quills/pages/team-tickets/ticket-scope";
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/tickets/",
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
