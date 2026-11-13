import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HelpCenterPage } from "@/quills/pages/help-center/help-center-page";

const searchSchema = z.object({ query: z.string().optional() });
export const Route = createFileRoute("/portal/$workspaceId/hc/")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <HelpCenterPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
