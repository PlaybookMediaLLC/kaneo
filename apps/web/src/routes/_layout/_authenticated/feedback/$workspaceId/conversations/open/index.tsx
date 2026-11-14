import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TeamConversationsPage } from "@/quills/pages/team-conversations/team-conversations-page";
const searchSchema = z.object({
  status: z.string().max(20).optional(),
  savedView: z.string().max(200).optional(),
  // The router reads "?q=42" as a number and "?new=true" as true.
  q: z
    .union([z.string().max(200), z.number()])
    .optional()
    .catch(undefined),
  new: z.boolean().optional().catch(undefined),
  next: z.boolean().optional().catch(undefined),
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
