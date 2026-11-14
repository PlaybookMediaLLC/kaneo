import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamTicketsPage } from "@/quills/pages/team-tickets/team-tickets-page";
const searchSchema = z.object({ status: z.string().optional() });
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/tickets/",
)({ validateSearch: searchSchema, component: RouteComponent });
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
