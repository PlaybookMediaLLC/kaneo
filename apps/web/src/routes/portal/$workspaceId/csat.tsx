import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CsatPage } from "@/quills/pages/csat/csat-page";

import { removeTokenFromAddress, stashToken } from "@/quills/core/token-stash";
const searchSchema = z.object({
  token: z.string().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
export const Route = createFileRoute("/portal/$workspaceId/csat")({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    const value = removeTokenFromAddress("query");
    if (value) stashToken(`${params.workspaceId}:csat`, value, false);
  },
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <CsatPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
