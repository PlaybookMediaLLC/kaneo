import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../database/quills/client";
import { hookDeliveries } from "../../database/quills/schema/hook-deliveries";

/**
 * One row per delivery key in `hook_deliveries`:
 * - `processing`: an attempt started its external call and has not recorded the outcome.
 * - `completed`: delivered. Never sent again.
 * - `failed`: certainly not delivered. A later attempt may send.
 * - `uncertain`: an attempt may have delivered. Never sent again automatically.
 */
type Outcome = "completed" | "failed" | "uncertain";

/**
 * Records an attempt before the external call. Returns `send` only to the attempt that may call out.
 * A `processing` row from an earlier attempt means it stopped after it may have sent: that becomes `uncertain`.
 */
export async function claimDelivery(
  db: Database,
  key: string,
  hookType: string,
): Promise<"send" | "completed" | "uncertain"> {
  const claimed = await db
    .insert(hookDeliveries)
    .values({ jobId: key, hookType, outcome: "processing" })
    .onConflictDoUpdate({
      target: [hookDeliveries.workspaceId, hookDeliveries.jobId],
      set: { outcome: "processing", processedAt: sql`now()` },
      setWhere: eq(hookDeliveries.outcome, "failed"),
    })
    .returning({ key: hookDeliveries.jobId });
  if (claimed.length) return "send";
  const [row] = await db
    .select({ outcome: hookDeliveries.outcome })
    .from(hookDeliveries)
    .where(eq(hookDeliveries.jobId, key))
    .for("update");
  if (row?.outcome === "completed") return "completed";
  if (row?.outcome === "processing") await settleDelivery(db, key, "uncertain");
  return "uncertain";
}

/** Records the outcome of the attempt that holds the `processing` row. */
export async function settleDelivery(
  db: Database,
  key: string,
  outcome: Outcome,
) {
  await db
    .update(hookDeliveries)
    .set({ outcome, processedAt: sql`now()` })
    .where(
      and(
        eq(hookDeliveries.jobId, key),
        eq(hookDeliveries.outcome, "processing"),
      ),
    );
}
