import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamTicketPage } from "@/quills/pages/team-ticket/team-ticket-page";
const searchSchema = z.object({
  view: z.string().optional(),
  status: z.string().optional(),
});
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/tickets/$ticketId/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamTicketPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
