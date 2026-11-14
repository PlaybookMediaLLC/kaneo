import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamConversationsPage } from "@/quills/pages/team-conversations/team-conversations-page";
const searchSchema = z.object({
  status: z.string().max(20).optional(),
  savedView: z.string().max(200).optional(),
});
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/conversations/open/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamConversationsPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={{ ...params, view: "open" }}
      search={Route.useSearch()}
    />
  );
}
