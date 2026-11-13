import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { RoadmapPage } from "@/quills/pages/roadmap/roadmap-page";
import { listPortalRoadmapsQuery } from "@/quills/api/feedback/list-portal-roadmaps";
const searchSchema = z.object({
  roadmap: z.string().max(200).optional().catch(undefined),
  search: z.string().max(200).optional().catch(undefined),
  sort: z.enum(["votes", "newest", "oldest"]).optional().catch(undefined),
});
export const Route = createFileRoute("/portal/$workspaceId/roadmap")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params, cause }) => {
    if (!context.quillsPortal.accessGranted || cause === "stay") return;
    await context.queryClient.prefetchQuery(
      listPortalRoadmapsQuery(
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
    <RoadmapPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
