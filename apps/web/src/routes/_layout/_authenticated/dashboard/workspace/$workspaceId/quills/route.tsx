import { createFileRoute } from "@tanstack/react-router";
import { ensureQuillsI18n } from "@/quills/i18n/load";
import { TeamRoute } from "@/quills/team/team-route";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/quills",
)({
  beforeLoad: ensureQuillsI18n,
  component: TeamRoute,
});
