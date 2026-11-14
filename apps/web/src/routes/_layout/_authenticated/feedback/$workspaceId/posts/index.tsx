import { createFileRoute } from "@tanstack/react-router";
import { postSearch } from "@/quills/pages/team-posts/post-search";
import { TeamPostsPage } from "@/quills/pages/team-posts/team-posts-page";
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/posts/",
)({ validateSearch: postSearch, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamPostsPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
