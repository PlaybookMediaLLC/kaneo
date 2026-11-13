import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { UnsubscribePage } from "@/quills/pages/unsubscribe/unsubscribe-page";
import { removeTokenFromAddress, stashToken } from "@/quills/core/token-stash";
const searchSchema = z.object({ token: z.string().optional() });
export const Route = createFileRoute("/portal/$workspaceId/unsubscribe")({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    const value = removeTokenFromAddress("query");
    if (value)
      stashToken(
        [
          params.workspaceId,
          ...Object.entries(params)
            .filter(([key]) => key !== "workspaceId")
            .map(([, item]) => item),
          "unsubscribe",
        ].join(":"),
        value,
        false,
      );
  },
  component: RouteComponent,
});
function RouteComponent() {
  return (
    <UnsubscribePage
      workspaceId={Route.useParams().workspaceId}
      params={Route.useParams()}
      search={Route.useSearch()}
    />
  );
}
