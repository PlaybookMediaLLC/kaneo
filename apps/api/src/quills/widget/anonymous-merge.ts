// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { principal } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import { hashToken } from "../framework/audience";
import type { Database } from "../framework/define-route";
import { repoint } from "../directory/lead-merge";

type PrincipalId = typeof principal.$inferSelect.id;

/**
 * Identify's `previousToken` merge: the anonymous widget session's activity (its conversations,
 * votes and the rest of directory/lead-merge.ts#repoint) moves to the identified visitor, in the
 * identify transaction. The session must be live in this workspace and be the caller's own (the
 * request's Bearer resolved to the same anonymous principal), and the principal must be an
 * anonymous visitor that is neither a test customer nor blocked. The anonymous session ends; the
 * empty anonymous principal is left to the anonymous visitor sweep. Returns the merged principal.
 */
export async function mergeAnonymousSession(
  db: Database,
  previousToken: string,
  caller: PrincipalId,
  target: PrincipalId,
) {
  if (caller === target) return null;
  // The key of framework/audience.ts#mintWidgetSession.
  const key = `widget:session:${hashToken(previousToken)}`;
  const [session] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, key),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .for("update");
  const owner = (session?.value as { principalId?: unknown } | undefined)
    ?.principalId;
  if (owner !== caller) return null;
  const [anonymous] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        eq(principal.id, caller),
        eq(principal.type, "anonymous"),
        isNull(principal.testOwnerPrincipalId),
        isNull(principal.blockedAt),
      ),
    )
    .for("update");
  if (!anonymous) return null;
  await repoint(db, anonymous.id, target);
  await db
    .delete(kvStore)
    .where(and(eq(kvStore.workspaceKey, "_"), eq(kvStore.key, key)));
  return anonymous.id;
}
