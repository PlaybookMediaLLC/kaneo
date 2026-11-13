import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SamplePage } from "@/quills/pages/sample/sample-page";
import { getPublicPortalConfigQuery } from "@/quills/api/portal/get-public-portal-config";
const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/sample")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params, search }) => {
    void search;
    if (!context.quillsPortal.portalAvailable) return;
    await context.queryClient.prefetchQuery(
      getPublicPortalConfigQuery(
        { param: { workspace: params.workspaceId } },
        context.quillsPortal.viewer,
      ),
    );
  },
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <SamplePage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
