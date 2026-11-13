import type { PageMeta } from "../../core/types";
export const meta = {
  id: "oauth-result",
  feature: "oauth-result",
  route: "/quills/oauth/result",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [],
  states: ["failed", "ready"],
} satisfies PageMeta;
