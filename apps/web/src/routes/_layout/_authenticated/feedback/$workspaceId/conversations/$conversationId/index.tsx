import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamConversationPage } from "@/quills/pages/team-conversation/team-conversation-page";
const searchSchema = z.object({
  view: z.string().optional(),
  status: z.string().optional(),
  savedView: z.string().optional(),
  // The router reads "?q=42" as a number.
  q: z
    .union([z.string().max(200), z.number()])
    .optional()
    .catch(undefined),
});
export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId/conversations/$conversationId/",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <TeamConversationPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
