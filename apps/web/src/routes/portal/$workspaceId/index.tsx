import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FeedbackHomePage } from "@/quills/pages/feedback-home/feedback-home-page";
import { listPortalBoardsQuery } from "@/quills/api/feedback/list-portal-boards";
import { listPortalPostsInfiniteQuery } from "@/quills/api/feedback/list-portal-posts";

const searchSchema = z.object({
  stage: z
    .enum(["open", "planned", "in_progress", "shipped"])
    .optional()
    .catch(undefined),
  search: z.string().max(200).optional().catch(undefined),
  sort: z.enum(["newest", "oldest", "votes"]).optional().catch(undefined),
});
export const Route = createFileRoute("/portal/$workspaceId/")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params, search, cause }) => {
    if (!context.quillsPortal.accessGranted || cause === "stay") return;
    const boardsInput = {
      param: { workspace: params.workspaceId },
      query: { counts: "true" as const },
    };
    const postsInput = {
      param: { workspace: params.workspaceId },
      query: {
        sort: search.sort ?? "newest",
        search: search.search,
        stage: search.stage,
        limit: "10",
      },
    };
    await Promise.all([
      context.queryClient.prefetchQuery(
        listPortalBoardsQuery(boardsInput, context.quillsPortal.viewer),
      ),
      context.queryClient.prefetchInfiniteQuery(
        listPortalPostsInfiniteQuery(postsInput, context.quillsPortal.viewer),
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
