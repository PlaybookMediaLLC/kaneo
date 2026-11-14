import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyTeamHref } from "@/quills/team/team-href";

// RFC 0004: the teammate pages moved to /feedback/{id}. Old links keep working.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/quills/$",
)({
  beforeLoad: ({ location }) => {
    throw redirect({ href: legacyTeamHref(location), replace: true });
  },
});
