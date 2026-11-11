import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { InviteId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { INVITE_TTL_MS, inviteUrl, mintInviteToken } from "./invite-token";

// Teammate routes for portal invites. An invite gives one email address access to a private
// portal; it never makes anyone a workspace member. The invite mail is sent after commit by the
// quills.mail worker (jobs/fanout.ts), never in the request. No response carries a token hash.

const invite = z.object({
  id: z.string(),
  email: z.string(),
  status: z.enum(["pending", "accepted", "canceled", "expired"]),
  createdAt: responseTimestamp,
  lastSentAt: nullableResponseTimestamp,
  expiresAt: responseTimestamp,
  acceptedAt: nullableResponseTimestamp,
});
const fields = {
  id: portalInvites.id,
  email: portalInvites.email,
  status: portalInvites.status,
  createdAt: portalInvites.createdAt,
  lastSentAt: portalInvites.lastSentAt,
  expiresAt: portalInvites.expiresAt,
  acceptedAt: portalInvites.acceptedAt,
};
type Row = { status: z.infer<typeof invite>["status"]; expiresAt: Date };
/** A pending invite past its expiry reads as expired. */
const view = <T extends Row>(row: T) => ({
  ...row,
  status:
    row.status === "pending" && row.expiresAt <= new Date()
      ? ("expired" as const)
      : row.status,
});
const params = z.object({ inviteId: flexibleToTypeIdSchema("invite") });
const errors = {
  404: "Invite not found",
  409: "The invite is no longer pending",
};

/** 404 for an invite that does not exist here, 409 for one that is not pending and unexpired. */
async function notPending(db: Database, inviteId: InviteId): Promise<never> {
  const [row] = await db
    .select({ id: portalInvites.id })
    .from(portalInvites)
    .where(eq(portalInvites.id, inviteId));
  throw row
    ? new HTTPException(409, { message: "The invite is no longer pending" })
    : new HTTPException(404, { message: "Invite not found" });
}

const pending = (inviteId: InviteId) =>
  and(
    eq(portalInvites.id, inviteId),
    eq(portalInvites.status, "pending"),
    gt(portalInvites.expiresAt, sql`now()`),
  );

const send = defineQuillsRoute({
  method: "post",
  path: "/portal/invites",
  operationId: "sendQuillsPortalInvite",
  summary: "Invite one email address to the portal",
  description:
    "Gives the address portal access after its owner signs in with an account that has this verified email. It never adds a workspace member. The mail is sent after commit. One address per request; the source's batch of 50 is a client loop.",
  action: "manage_settings",
  body: z.object({
    email: z.string().trim().toLowerCase().email().max(320),
    message: z.string().trim().max(500).optional(),
  }),
  response: invite,
  responseDescription: "The new invite",
  errors: { 409: "A pending invite exists for this address" },
  event: (_input, result) => ({
    type: "portal.invite_sent",
    entityType: "portal_invite",
    entityId: result.id,
  }),
  handler: async ({ db, actor, body }) => {
    // An expired invite no longer holds the one pending slot per address.
    await db
      .update(portalInvites)
      .set({ status: "expired" })
      .where(
        and(
          eq(portalInvites.email, body.email),
          eq(portalInvites.status, "pending"),
          lte(portalInvites.expiresAt, sql`now()`),
        ),
      );
    const now = new Date();
    const [row] = await db
      .insert(portalInvites)
      .values({
        email: body.email,
        message: body.message || null,
        invitedByPrincipalId: actor.principalId,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        lastSentAt: now,
      })
      .onConflictDoNothing()
      .returning(fields);
    if (!row)
      throw new HTTPException(409, {
        message: "A pending invite exists for this address",
      });
    return view(row);
  },
});

const list = defineQuillsRoute({
  method: "get",
  path: "/portal/invites",
  operationId: "listQuillsPortalInvites",
  summary: "List portal invites",
  description: "Pending invites first, then the newest. At most 100.",
  action: "manage_settings",
  response: z.object({ invites: z.array(invite) }),
  responseDescription: "Portal invites",
  handler: async ({ db }) => {
    const rows = await db
      .select(fields)
      .from(portalInvites)
      .orderBy(
        sql`(${portalInvites.status} = 'pending') desc`,
        sql`${portalInvites.lastSentAt} desc nulls last`,
        desc(portalInvites.createdAt),
      )
      .limit(100);
    return { invites: rows.map(view) };
  },
});

const resend = defineQuillsRoute({
  method: "post",
  path: "/portal/invites/{inviteId}/resend",
  operationId: "resendQuillsPortalInvite",
  summary: "Send a portal invite again",
  description:
    "Extends a pending, unexpired invite by 30 days and mails a new link after commit. Earlier links keep working.",
  action: "manage_settings",
  params,
  response: invite,
  responseDescription: "The invite",
  errors,
  event: ({ params }) => ({
    type: "portal.invite_resent",
    entityType: "portal_invite",
    entityId: params.inviteId,
  }),
  handler: async ({ db, params }) => {
    const now = new Date();
    const [row] = await db
      .update(portalInvites)
      .set({
        lastSentAt: now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      })
      .where(pending(params.inviteId))
      .returning(fields);
    return row ? view(row) : notPending(db, params.inviteId);
  },
});

const cancel = defineQuillsRoute({
  method: "delete",
  path: "/portal/invites/{inviteId}",
  operationId: "cancelQuillsPortalInvite",
  summary: "Cancel a pending portal invite",
  description:
    "Every link of the invite stops working. An accepted invite cannot be canceled here, and the access policy does not override it: to remove an invitee's access, block the person.",
  action: "manage_settings",
  params,
  response: invite,
  responseDescription: "The canceled invite",
  errors,
  event: ({ params }) => ({
    type: "portal.invite_canceled",
    entityType: "portal_invite",
    entityId: params.inviteId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(portalInvites)
      .set({ status: "canceled", tokenHashes: [] })
      .where(
        and(
          eq(portalInvites.id, params.inviteId),
          eq(portalInvites.status, "pending"),
        ),
      )
      .returning(fields);
    return row ? view(row) : notPending(db, params.inviteId);
  },
});

const link = defineQuillsRoute({
  method: "post",
  path: "/portal/invites/{inviteId}/link",
  operationId: "createQuillsPortalInviteLink",
  summary: "Create a link for a pending portal invite",
  description:
    "For a teammate who shares the link by hand. The link expires with the invite and works only for the invited address. Earlier links keep working.",
  action: "manage_settings",
  params,
  response: z.object({ inviteUrl: z.string(), expiresAt: responseTimestamp }),
  responseDescription: "The invite link",
  errors,
  event: ({ params }) => ({
    type: "portal.invite_link_created",
    entityType: "portal_invite",
    entityId: params.inviteId,
  }),
  handler: async ({ db, params, workspaceId }) => {
    const minted = await mintInviteToken(db, params.inviteId);
    if (!minted) return notPending(db, params.inviteId);
    return {
      inviteUrl: inviteUrl(workspaceId, params.inviteId, minted.token),
      expiresAt: minted.expiresAt,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...send)
  .openapi(...list)
  .openapi(...resend)
  .openapi(...cancel)
  .openapi(...link);
