import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HelpCenterArticlePage } from "@/quills/pages/help-center-article/help-center-article-page";

const searchSchema = z.object({});
export const Route = createFileRoute(
  "/portal/$workspaceId/hc/$locale/articles/$idSlug",
)({ validateSearch: searchSchema, component: RouteComponent });
function RouteComponent() {
  const params = Route.useParams();
  return (
    <HelpCenterArticlePage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
