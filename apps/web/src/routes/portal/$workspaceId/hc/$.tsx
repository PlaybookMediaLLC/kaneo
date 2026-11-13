import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HelpCenterRedirectPage } from "@/quills/pages/help-center-redirect/help-center-redirect-page";

const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/hc/$")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <HelpCenterRedirectPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
