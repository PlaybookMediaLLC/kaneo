import type { PageMeta } from "../../core/types";
export const meta = {
  id: "my-feedback",
  feature: "my-feedback",
  route: "/portal/$workspaceId/my-feedback",
  audience: "signed-in",
  mailLinked: true,
  token: "none",
  operations: [
    "listQuillsPortalMyFeedback",
    "getQuillsMyWeeklyDigestPreference",
    "setQuillsMyWeeklyDigestPreference",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
