import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PostPage } from "@/quills/pages/post/post-page";
import { getPortalPostQuery } from "@/quills/api/feedback/get-portal-post";
import { listPortalPostCommentsQuery } from "@/quills/api/feedback/list-portal-post-comments";

const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/posts/$postId")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params }) => {
    if (!context.quillsPortal.accessGranted) return;
    const input = {
      param: {
        workspace: params.workspaceId,
        postId: params.postId,
      },
    };
    await Promise.all([
      context.queryClient.prefetchQuery(
        getPortalPostQuery(input, context.quillsPortal.viewer),
      ),
      context.queryClient.prefetchInfiniteQuery(
        listPortalPostCommentsQuery(
          { ...input, query: { offset: "0", limit: "100" } },
          context.quillsPortal.viewer,
        ),
      ),
    ]);
  },
  component: RouteComponent,
});
function RouteComponent() {
  return (
    <PostPage
      workspaceId={Route.useParams().workspaceId}
      params={Route.useParams()}
      search={Route.useSearch()}
    />
  );
}
