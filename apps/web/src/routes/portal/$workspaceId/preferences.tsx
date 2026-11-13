import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PreferencesPage } from "@/quills/pages/preferences/preferences-page";

const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/preferences")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <PreferencesPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
