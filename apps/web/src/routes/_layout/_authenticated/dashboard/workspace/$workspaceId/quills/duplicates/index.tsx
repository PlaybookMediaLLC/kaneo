import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamDuplicatesPage } from "@/quills/pages/team-duplicates/team-duplicates-page";
const searchSchema = z.object({});
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/duplicates/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamDuplicatesPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
