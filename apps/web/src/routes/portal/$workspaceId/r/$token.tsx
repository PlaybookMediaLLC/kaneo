import { createFileRoute } from "@tanstack/react-router";
import { MagicLinkRequestPage } from "@/quills/pages/magic-link-request/magic-link-request-page";

export const Route = createFileRoute("/portal/$workspaceId/r/$token")({
  component: RouteComponent,
});

function RouteComponent() {
  const { workspaceId, token } = Route.useParams();
  return <MagicLinkRequestPage workspaceId={workspaceId} token={token} />;
}
