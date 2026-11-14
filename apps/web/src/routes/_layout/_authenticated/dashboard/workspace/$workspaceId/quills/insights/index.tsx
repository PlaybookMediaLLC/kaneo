import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamInsightsPage } from "@/quills/pages/team-insights/team-insights-page";
const searchSchema = z.object({});
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/insights/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamInsightsPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
