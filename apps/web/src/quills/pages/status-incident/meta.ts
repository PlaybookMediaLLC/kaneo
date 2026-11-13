import type { PageMeta } from "../../core/types";
export const meta = {
  id: "status-incident",
  feature: "status-incident",
  route: "/portal/$workspaceId/status/incidents/$incidentId",
  audience: "public",
  mailLinked: true,
  token: "none",
  operations: ["getQuillsPublicStatusIncident"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
