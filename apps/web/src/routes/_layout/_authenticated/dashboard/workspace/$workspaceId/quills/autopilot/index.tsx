import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamAutopilotPage } from "@/quills/pages/team-autopilot/team-autopilot-page";
const searchSchema = z.object({});
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/autopilot/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamAutopilotPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
