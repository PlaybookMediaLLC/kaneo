import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { StatusPage } from "@/quills/pages/status/status-page";

const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/status/")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <StatusPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
