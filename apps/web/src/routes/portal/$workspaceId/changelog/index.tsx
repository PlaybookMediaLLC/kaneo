import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ChangelogPage } from "@/quills/pages/changelog/changelog-page";

const searchSchema = z.object({ offset: z.coerce.number().optional() });
export const Route = createFileRoute("/portal/$workspaceId/changelog/")({
  validateSearch: searchSchema,
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <ChangelogPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
