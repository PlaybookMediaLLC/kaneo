import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { StatusIncidentPage } from "@/quills/pages/status-incident/status-incident-page";
import { getPublicStatusIncidentQuery } from "@/quills/api/status/get-public-status-incident";

const searchSchema = z.object({});
export const Route = createFileRoute(
  "/portal/$workspaceId/status/incidents/$incidentId",
)({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params }) => {
    if (!context.quillsPortal.portalAvailable) return;
    await context.queryClient.prefetchQuery(
      getPublicStatusIncidentQuery(
        {
          param: {
            workspace: params.workspaceId,
            incidentId: params.incidentId,
          },
        },
        context.quillsPortal.viewer,
      ),
    );
  },
  component: RouteComponent,
});
function RouteComponent() {
  return (
    <StatusIncidentPage
      workspaceId={Route.useParams().workspaceId}
      params={Route.useParams()}
      search={Route.useSearch()}
    />
  );
}
