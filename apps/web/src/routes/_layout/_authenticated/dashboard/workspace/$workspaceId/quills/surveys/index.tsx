import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamSurveysPage } from "@/quills/pages/team-surveys/team-surveys-page";
const searchSchema = z.object({});
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/surveys/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamSurveysPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
