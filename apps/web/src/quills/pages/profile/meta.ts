import type { PageMeta } from "../../core/types";
export const meta = {
  id: "profile",
  feature: "profile",
  route: "/portal/$workspaceId/profile",
  audience: "signed-in",
  mailLinked: false,
  token: "none",
  operations: [
    "getQuillsCustomerProfile",
    "updateQuillsCustomerProfile",
    "getQuillsPublicUserProfile",
  ],
  states: ["loading", "notFound", "rateLimited", "failed", "ready", "done"],
} satisfies PageMeta;
