import type { PageMeta } from "../../core/types";
export const meta = {
  id: "unsubscribe",
  feature: "unsubscribe",
  route: "/portal/$workspaceId/unsubscribe",
  audience: "public",
  mailLinked: true,
  token: "query",
  operations: [
    "previewQuillsUnsubscribeToken",
    "processQuillsUnsubscribeToken",
  ],
  states: ["loading", "gone", "failed", "ready", "done"],
} satisfies PageMeta;
