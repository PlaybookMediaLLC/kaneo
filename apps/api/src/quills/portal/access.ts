import { apiRouter, z } from "../../openapi";
import { defineQuillsRoute } from "../framework/define-route";
import { portalAccess } from "./gate";

// The private-portal gate for the calling Kaneo account. Only the decision leaves the server;
// the policy (allowed domains and segments) does not.

const decision = z.object({
  granted: z.boolean(),
  reason: z.enum([
    "public",
    "team",
    "domain",
    "segment",
    "invite",
    "unauthenticated",
    "unauthorized",
  ]),
});

const myAccess = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/portal/access",
  operationId: "evaluateQuillsMyPortalAccess",
  summary: "Evaluate the caller's portal access",
  description:
    "A workspace member is granted with the reason team but still acts as a customer on portal routes.",
  action: "read",
  response: decision,
  responseDescription: "The access decision",
  handler: ({ db, caller }) => portalAccess(db, caller),
});

const recordDenied = defineQuillsRoute({
  audience: "portal",
  method: "post",
  path: "/portal/access-denied",
  operationId: "recordQuillsPortalAccessDenied",
  summary: "Record that the portal denied the caller",
  description:
    "The server evaluates the decision again; a caller who has access records nothing.",
  action: "update",
  rateLimit: { limit: 20, windowSeconds: 600 },
  response: z.object({ recorded: z.boolean(), reason: decision.shape.reason }),
  responseDescription: "Whether a denial was recorded",
  event: ({ workspaceId }, result) =>
    result.recorded && {
      type: "portal.access_denied",
      entityType: "settings",
      entityId: workspaceId,
      payload: { reason: result.reason },
    },
  handler: async ({ db, caller }) => {
    const access = await portalAccess(db, caller);
    return { recorded: !access.granted, reason: access.reason };
  },
});

export default apiRouter()
  .openapi(...myAccess)
  .openapi(...recordDenied);
