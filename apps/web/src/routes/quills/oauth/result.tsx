import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ensureQuillsI18n } from "@/quills/i18n/load";
import { OauthResultPage } from "@/quills/pages/oauth-result/oauth-result-page";

const searchSchema = z.object({
  outcome: z
    .enum([
      "connected",
      "already_used",
      "denied",
      "unauthorized",
      "no_access",
      "not_found",
      "restart",
      "failed",
    ])
    .catch("failed"),
  name: z.string().max(200).optional().catch(undefined),
});

export const Route = createFileRoute("/quills/oauth/result")({
  validateSearch: searchSchema,
  beforeLoad: ensureQuillsI18n,
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <OauthResultPage
      workspaceId=""
      params={Route.useParams()}
      search={Route.useSearch()}
    />
  );
}
