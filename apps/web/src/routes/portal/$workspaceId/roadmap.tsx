import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { RoadmapPage } from "@/quills/pages/roadmap/roadmap-page";
import { listPortalBoardsQuery } from "@/quills/api/feedback/list-portal-boards";
import { listPortalStatusesQuery } from "@/quills/api/feedback/list-portal-statuses";
import { listPortalPostsInfiniteQuery } from "@/quills/api/feedback/list-portal-posts";
const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/roadmap")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params }) => {
    if (!context.quillsPortal.accessGranted) return;
    const viewer = context.quillsPortal.viewer;
    const workspace = { workspace: params.workspaceId };
    await Promise.all([
      context.queryClient.prefetchQuery(
        listPortalStatusesQuery({ param: workspace }, viewer),
      ),
      context.queryClient.prefetchQuery(
        listPortalBoardsQuery(
          { param: workspace, query: { counts: "false" } },
          viewer,
        ),
      ),
      // The default columns; a workspace that hides one wastes one small request.
      ...(["planned", "in_progress", "shipped"] as const).map((stage) =>
        context.queryClient.prefetchInfiniteQuery(
          listPortalPostsInfiniteQuery(
            { param: workspace, query: { stage, sort: "votes", limit: "20" } },
            viewer,
          ),
        ),
      ),
    ]);
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
