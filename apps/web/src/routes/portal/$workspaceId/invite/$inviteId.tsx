import { createFileRoute } from "@tanstack/react-router";
import { InvitePage } from "@/quills/pages/invite/invite-page";
import { removeTokenFromAddress, stashToken } from "@/quills/core/token-stash";
export const Route = createFileRoute("/portal/$workspaceId/invite/$inviteId")({
  beforeLoad: ({ params }) => {
    const value = removeTokenFromAddress("fragment");
    if (value)
      stashToken(
        `${params.workspaceId}:${params.inviteId}:invite`,
        value,
        true,
      );
  },
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <InvitePage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
