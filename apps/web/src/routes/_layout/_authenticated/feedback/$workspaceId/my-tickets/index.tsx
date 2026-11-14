import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamTicketsPage } from "@/quills/pages/team-tickets/team-tickets-page";
const searchSchema = z.object({ status: z.string().optional() });
// "My tickets": the ticket inbox page with the caller's tickets only.
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/my-tickets/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamTicketsPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={{ ...Route.useSearch(), view: "mine" }}
    />
  );
}
