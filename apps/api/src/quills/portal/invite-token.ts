import { and, eq, gt, sql } from "drizzle-orm";
import type { InviteId } from "@kaneo/ids";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { hashToken } from "../framework/audience";
import type { Database } from "../framework/define-route";
import { portalPaths } from "./paths";

// Route-module helper: invite tokens. A token is 32 random bytes; only its SHA-256 hash is stored.

export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The web page that signs the invitee in with their Kaneo account and accepts the invite. The
 * token is in the fragment, so it never reaches a server or proxy log.
 */
export const inviteUrl = (
  workspaceId: string,
  inviteId: string,
  token: string,
) => portalPaths.invite(workspaceId, inviteId, token);

/**
 * Adds a new token to a pending, unexpired invite, or returns undefined. The newest 20 tokens stay
 * valid, so a second send or a copied link does not break a link the invitee already holds.
 */
export async function mintInviteToken(db: Database, inviteId: InviteId) {
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  const [invite] = await db
    .update(portalInvites)
    .set({
      tokenHashes: sql`(array_append(${portalInvites.tokenHashes}, ${hashToken(token)}))[greatest(cardinality(${portalInvites.tokenHashes}) - 18, 1):]`,
    })
    .where(
      and(
        eq(portalInvites.id, inviteId),
        eq(portalInvites.status, "pending"),
        gt(portalInvites.expiresAt, sql`now()`),
      ),
    )
    .returning({
      workspaceId: portalInvites.workspaceId,
      email: portalInvites.email,
      message: portalInvites.message,
      expiresAt: portalInvites.expiresAt,
    });
  return invite && { ...invite, token };
}
