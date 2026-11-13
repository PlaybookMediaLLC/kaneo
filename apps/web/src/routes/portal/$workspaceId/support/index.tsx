import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SupportPage } from "@/quills/pages/support/support-page";

const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/support/")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <SupportPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
