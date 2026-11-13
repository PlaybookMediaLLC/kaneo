import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HelpCenterCategoryPage } from "@/quills/pages/help-center-category/help-center-category-page";

const searchSchema = z.object({});
export const Route = createFileRoute(
  "/portal/$workspaceId/hc/$locale/collections/$idSlug",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <HelpCenterCategoryPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
