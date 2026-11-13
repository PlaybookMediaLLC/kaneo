import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TicketsPage } from "@/quills/pages/tickets/tickets-page";

const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/support/tickets")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TicketsPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
