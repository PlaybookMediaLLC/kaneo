import type { PageMeta } from "../../core/types";
export const meta = {
  id: "invite",
  feature: "invite",
  route: "/portal/$workspaceId/invite/$inviteId",
  audience: "signed-in",
  mailLinked: true,
  token: "fragment",
  operations: ["acceptQuillsPortalInvite"],
  states: ["loading", "gone", "failed", "ready", "done"],
} satisfies PageMeta;
