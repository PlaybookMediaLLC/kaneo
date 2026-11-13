import type { PageMeta } from "../../core/types";
export const meta = {
  id: "roadmap",
  feature: "feedback",
  route: "/portal/$workspaceId/roadmap",
  audience: "portal",
  mailLinked: false,
  token: "none",
  operations: ["listQuillsPortalRoadmaps", "listQuillsPortalRoadmapPosts"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
