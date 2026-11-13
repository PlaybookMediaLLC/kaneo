import type { PageMeta } from "../../core/types";
export const meta = {
  id: "csat",
  feature: "csat",
  route: "/portal/$workspaceId/csat",
  audience: "public",
  mailLinked: true,
  token: "query",
  operations: ["validateQuillsCsatEmailToken", "recordQuillsCsatViaToken"],
  states: ["loading", "gone", "failed", "ready", "done"],
} satisfies PageMeta;
