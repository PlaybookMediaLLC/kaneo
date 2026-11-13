import type { PageMeta } from "../../core/types";
export const meta = {
  id: "preferences",
  feature: "preferences",
  route: "/portal/$workspaceId/preferences",
  audience: "signed-in",
  mailLinked: false,
  token: "none",
  operations: [
    "getQuillsMyLanguagePreference",
    "setQuillsMyLanguagePreference",
    "getQuillsMyChangelogSubscription",
    "subscribeQuillsMyChangelog",
    "unsubscribeQuillsMyChangelog",
    "getQuillsMyStatusSubscription",
    "subscribeQuillsStatus",
    "unsubscribeQuillsStatus",
  ],
  states: ["loading", "rateLimited", "failed", "ready", "done"],
} satisfies PageMeta;
