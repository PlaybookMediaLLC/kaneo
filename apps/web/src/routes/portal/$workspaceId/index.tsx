import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FeedbackHomePage } from "@/quills/pages/feedback-home/feedback-home-page";
import { listPortalBoardsQuery } from "@/quills/api/feedback/list-portal-boards";
import { listPortalPostsInfiniteQuery } from "@/quills/api/feedback/list-portal-posts";
import { listPortalStatusesQuery } from "@/quills/api/feedback/list-portal-statuses";

const searchSchema = z.object({
  stage: z.enum(["open", "planned", "in_progress", "shipped"]).optional(),
  sort: z.enum(["newest", "oldest", "votes"]).optional(),
  openFeedback: z.unknown().optional(),
});
export const Route = createFileRoute("/portal/$workspaceId/")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params, search }) => {
    if (!context.quillsPortal.accessGranted) return;
    const viewer = context.quillsPortal.viewer;
    const workspace = { workspace: params.workspaceId };
    await Promise.all([
      context.queryClient.prefetchQuery(
        listPortalBoardsQuery(
          { param: workspace, query: { counts: "true" } },
          viewer,
        ),
      ),
      context.queryClient.prefetchQuery(
        listPortalStatusesQuery({ param: workspace }, viewer),
      ),
      context.queryClient.prefetchInfiniteQuery(
        listPortalPostsInfiniteQuery(
          {
            param: workspace,
            query: {
              stage: search.stage,
              sort: search.sort ?? "votes",
              limit: "20",
            },
          },
          viewer,
        ),
      ),
    ]);
  },
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <FeedbackHomePage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
