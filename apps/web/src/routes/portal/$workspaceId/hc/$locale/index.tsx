import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HelpCenterLocalePage } from "@/quills/pages/help-center-locale/help-center-locale-page";

const searchSchema = z.object({ query: z.string().optional() });
export const Route = createFileRoute("/portal/$workspaceId/hc/$locale/")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <HelpCenterLocalePage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
