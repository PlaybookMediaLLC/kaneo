import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../openapi";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { hashToken } from "../framework/audience";
import { defineQuillsRoute } from "../framework/define-route";
import { requirePortalEnabled } from "./gate";

// The invitee's side of a portal invite (decision D1). The signed-in Kaneo account must hold the
// invited address, verified. Accepting creates the account's customer profile here (the
// customer_membership trigger accepts that link for the account the entry point vouched for) and
// never touches workspace membership. A failure rolls the profile back with the request.

const accept = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "post",
  path: "/portal/invites/{inviteId}/accept",
  operationId: "acceptQuillsPortalInvite",
  summary: "Accept a portal invite",
  description:
    "Send the token from the invite link. The signed-in account must have the invited email address, verified. Accepting again with the same account returns alreadyAccepted.",
  action: "update",
  rateLimit: { limit: 20, windowSeconds: 600 },
  params: z.object({ inviteId: flexibleToTypeIdSchema("invite") }),
  body: z.object({ token: z.string().min(20).max(200) }),
  response: z.object({ accepted: z.boolean(), alreadyAccepted: z.boolean() }),
  responseDescription: "The invite is accepted",
  errors: {
    403: "The account does not have the invited email address, verified",
    404: "Invite or portal not found",
    409: "The invite has expired",
  },
  event: ({ params }, result) =>
    !result.alreadyAccepted && {
      type: "portal.invite_accepted",
      entityType: "portal_invite",
      entityId: params.inviteId,
    },
  handler: async ({ db, caller, params, body }) => {
    await requirePortalEnabled(db);
    const account = caller.account!;
    const email = account.email.toLowerCase();
    const [invite] = await db
      .select({
        email: portalInvites.email,
        status: portalInvites.status,
        tokenHashes: portalInvites.tokenHashes,
        expiresAt: portalInvites.expiresAt,
      })
      .from(portalInvites)
      .where(eq(portalInvites.id, params.inviteId))
      .for("update");
    if (!invite) throw new HTTPException(404, { message: "Invite not found" });
    // A repeat visit by the account that accepted needs no token: the invite grants nothing new.
    if (invite.status === "accepted" && invite.email === email)
      return { accepted: true, alreadyAccepted: true };
    // An unknown token reveals nothing about the invite. Cancel clears the tokens, so it lands here.
    if (!invite.tokenHashes.includes(hashToken(body.token)))
      throw new HTTPException(404, { message: "Invite not found" });
    if (invite.email !== email)
      throw new HTTPException(403, {
        message: "This invite is for a different email address",
      });
    // An unverified account could be someone who registered the address first.
    if (!account.emailVerified)
      throw new HTTPException(403, {
        message: "Verify your email address, then accept the invite",
      });
    if (invite.status !== "pending" || invite.expiresAt <= new Date())
      throw new HTTPException(409, {
        message: "This invite has expired",
      });
    await db
      .update(portalInvites)
      .set({ status: "accepted", acceptedAt: new Date(), tokenHashes: [] })
      .where(
        and(
          eq(portalInvites.id, params.inviteId),
          eq(portalInvites.status, "pending"),
        ),
      );
    return { accepted: true, alreadyAccepted: false };
  },
});

export default apiRouter().openapi(...accept);
