import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { settings } from "../../database/quills/schema/auth";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import {
  evaluatePortalAccess,
  type PortalAccessDecision,
  type QuillsCaller,
} from "../framework/audience";
import type { Database } from "../framework/define-route";
import { parseJson } from "../settings/area";

// Route-module helper: the portal on/off switch and the private-portal gate with the invite grant.

/**
 * 404 while the portal is off. Portals are opt-in: the portal settings key `enabled` must be true.
 * The portal settings routes own that key; this module only reads it.
 */
export async function requirePortalEnabled(db: Database) {
  const [row] = await db
    .select({ portalConfig: settings.portalConfig })
    .from(settings)
    .limit(1);
  if (parseJson(row?.portalConfig ?? null).enabled !== true)
    throw new HTTPException(404, { message: "Portal not found" });
}

export type PortalDecision =
  | PortalAccessDecision
  | { granted: true; reason: "invite" };

/**
 * The private-portal decision of framework/audience.ts, plus the grant of an accepted invite to
 * the same verified email address (the source's invite branch). Fails closed.
 *
 * ponytail: the invite branch wraps evaluatePortalAccess because framework/audience.ts is owned
 * elsewhere; a denial that names "unauthorized" is the only one an invite can turn into a grant.
 * Move the branch into evaluatePortalAccess when the framework owner merges this slice.
 */
export async function portalAccess(
  db: Database,
  caller: QuillsCaller,
): Promise<PortalDecision> {
  const decision = await evaluatePortalAccess(db, caller);
  const account = caller.account;
  if (decision.granted || decision.reason !== "unauthorized") return decision;
  if (!account?.emailVerified) return decision;
  const [invite] = await db
    .select({ id: portalInvites.id })
    .from(portalInvites)
    .where(
      and(
        eq(portalInvites.email, account.email.toLowerCase()),
        eq(portalInvites.status, "accepted"),
      ),
    )
    .limit(1);
  return invite ? { granted: true, reason: "invite" } : decision;
}

/** 404 while the portal is off, 403 when the caller may not open a private portal. */
export async function requirePortalAccess(db: Database, caller: QuillsCaller) {
  await requirePortalEnabled(db);
  if (!(await portalAccess(db, caller)).granted)
    throw new HTTPException(403, { message: "Portal access denied" });
}
