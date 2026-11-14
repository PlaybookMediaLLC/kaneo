import { createFileRoute } from "@tanstack/react-router";
import { postSearch } from "@/quills/pages/team-posts/post-search";
import { TeamPostPage } from "@/quills/pages/team-post/team-post-page";
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/posts/$postId/",
)({ validateSearch: postSearch, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamPostPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
