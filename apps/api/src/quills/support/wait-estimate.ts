// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { conversations } from "../../database/quills/schema/conversation";
import { kvStore } from "../../database/quills/schema/kv";
import type { Database } from "../framework/define-route";
import { formatWaitEstimate } from "./office-hours-calc";

export interface WaitTimeEstimate {
  sampleCount: number;
  minMinutes: number;
  medianMinutes: number;
  maxMinutes: number;
  label: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const MIN_SAMPLES = 3;

/**
 * Computes an honest 30-day rolling wait-time estimate (p25/p50/p75 first-response
 * latency in minutes) scoped to the workspace (or team when >= MIN_SAMPLES exist).
 * Caches in `kv_store` for 5 minutes when called in a writable tx; on read-only
 * transactions reads cache first or computes directly via `conversations_first_response_idx`.
 */
export async function getWaitTimeEstimate(
  db: Database,
  options: { teamId?: TypeId<"team"> | null; allowCacheWrite?: boolean } = {},
): Promise<WaitTimeEstimate | null> {
  const key = `support:wait-estimate:${options.teamId ?? "all"}`;
  const [cached] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, key),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (cached?.value && typeof cached.value === "object") {
    const val = cached.value as Partial<WaitTimeEstimate> & { empty?: boolean };
    if (val.empty) return null;
    if (
      typeof val.medianMinutes === "number" &&
      typeof val.label === "string"
    ) {
      return val as WaitTimeEstimate;
    }
  }

  const queryPercentiles = async (teamId?: TypeId<"team"> | null) => {
    const [row] = await db
      .select({
        sampleCount: sql<number>`count(*)::int`,
        p25: sql<
          number | null
        >`percentile_cont(0.25) within group (order by extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt})) / 60.0)`,
        p50: sql<
          number | null
        >`percentile_cont(0.50) within group (order by extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt})) / 60.0)`,
        p75: sql<
          number | null
        >`percentile_cont(0.75) within group (order by extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt})) / 60.0)`,
      })
      .from(conversations)
      .where(
        and(
          isNotNull(conversations.firstResponseAt),
          gt(conversations.createdAt, sql`now() - interval '30 days'`),
          sql`${conversations.firstResponseAt} >= ${conversations.createdAt}`,
          sql`coalesce(${conversations.endReason}, '') <> 'spam'`,
          sql`NOT EXISTS (
            SELECT 1 FROM quills.principal p
            WHERE p.id = ${conversations.visitorPrincipalId}
              AND p.test_owner_principal_id IS NOT NULL
          )`,
          teamId ? eq(conversations.assignedTeamId, teamId) : undefined,
        ),
      );
    return row;
  };

  let stats = await queryPercentiles(options.teamId);
  if (options.teamId && (!stats || stats.sampleCount < MIN_SAMPLES)) {
    stats = await queryPercentiles(null);
  }

  const estimate: WaitTimeEstimate | null =
    stats &&
    stats.sampleCount >= MIN_SAMPLES &&
    stats.p25 !== null &&
    stats.p50 !== null &&
    stats.p75 !== null
      ? {
          sampleCount: stats.sampleCount,
          ...formatWaitEstimate(stats.p25, stats.p50, stats.p75),
        }
      : null;

  if (options.allowCacheWrite) {
    await db
      .insert(kvStore)
      .values({
        workspaceKey: "_",
        key,
        value: estimate
          ? (estimate as unknown as Record<string, unknown>)
          : { empty: true },
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      })
      .onConflictDoUpdate({
        target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
        set: {
          value: estimate
            ? (estimate as unknown as Record<string, unknown>)
            : { empty: true },
          expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        },
      });
  }

  return estimate;
}
