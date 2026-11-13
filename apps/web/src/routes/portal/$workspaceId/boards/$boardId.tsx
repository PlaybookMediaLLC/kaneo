import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FeedbackBoardPage } from "@/quills/pages/feedback-board/feedback-board-page";
import { listPortalBoardsQuery } from "@/quills/api/feedback/list-portal-boards";
import { listPortalPostsInfiniteQuery } from "@/quills/api/feedback/list-portal-posts";
import { listPortalStatusesQuery } from "@/quills/api/feedback/list-portal-statuses";

const searchSchema = z.object({
  stage: z
    .enum(["open", "planned", "in_progress", "shipped"])
    .optional()
    .catch(undefined),
  search: z.string().max(200).optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "votes"]).optional().catch(undefined),
});
export const Route = createFileRoute("/portal/$workspaceId/boards/$boardId")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params, search, cause }) => {
    if (!context.quillsPortal.accessGranted || cause === "stay") return;
    const viewer = context.quillsPortal.viewer;
    await Promise.all([
      context.queryClient.prefetchQuery(
        listPortalBoardsQuery(
          {
            param: { workspace: params.workspaceId },
            query: { counts: "true" },
          },
          viewer,
        ),
      ),
      context.queryClient.prefetchQuery(
        listPortalStatusesQuery(
          { param: { workspace: params.workspaceId } },
          viewer,
        ),
      ),
      context.queryClient.prefetchInfiniteQuery(
        listPortalPostsInfiniteQuery(
          {
            param: { workspace: params.workspaceId },
            query: {
              boardId: params.boardId,
              search: search.search,
              stage: search.stage,
              sort: search.sort ?? "newest",
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
    <FeedbackBoardPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
