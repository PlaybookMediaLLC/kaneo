import { createFileRoute } from "@tanstack/react-router";
import { TeamRoute } from "@/quills/team/team-route";

export const Route = createFileRoute(
  "/_layout/_authenticated/feedback/$workspaceId",
)({
  beforeLoad: async () => {
    const { ensureQuillsI18n } = await import("@/quills/i18n/load");
    await ensureQuillsI18n();
  },
  component: TeamRoute,
});
