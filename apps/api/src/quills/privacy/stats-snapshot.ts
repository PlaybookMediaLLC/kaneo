// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ConversationId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { supportDailyStats } from "../../database/quills/schema/privacy";
import { slaEvents } from "../../database/quills/schema/sla";
import type { Database } from "../framework/define-route";

type DayChannelBucket = {
  day: string;
  channel: string;
  conversationsCreated: number;
  conversationsResolved: number;
  messagesCount: number;
  slaFirstResponseMet: number;
  slaFirstResponseBreached: number;
  slaNextResponseMet: number;
  slaNextResponseBreached: number;
  slaResolutionMet: number;
  slaResolutionBreached: number;
  slaTimeToResolveMet: number;
  slaTimeToResolveBreached: number;
  csatSum: number;
  csatCount: number;
};

const utcDay = (date: Date) => date.toISOString().slice(0, 10);

function getBucket(
  buckets: Map<string, DayChannelBucket>,
  day: string,
  channel: string,
): DayChannelBucket {
  const key = `${day}:${channel}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      day,
      channel,
      conversationsCreated: 0,
      conversationsResolved: 0,
      messagesCount: 0,
      slaFirstResponseMet: 0,
      slaFirstResponseBreached: 0,
      slaNextResponseMet: 0,
      slaNextResponseBreached: 0,
      slaResolutionMet: 0,
      slaResolutionBreached: 0,
      slaTimeToResolveMet: 0,
      slaTimeToResolveBreached: 0,
      csatSum: 0,
      csatCount: 0,
    };
    buckets.set(key, bucket);
  }
  return bucket;
}

/**
 * Snapshots aggregate support & SLA metrics for a batch of conversations into
 * `quills.support_daily_stats` immediately before those rows are purged by retention or
 * hard-delete erasure (#329). Test-customer conversations are excluded, matching support reporting.
 */
export async function snapshotConversationsIntoDailyStats(
  db: Database,
  conversationIds: readonly ConversationId[],
): Promise<void> {
  if (conversationIds.length === 0) return;

  const rows = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      createdAt: conversations.createdAt,
      resolvedAt: conversations.resolvedAt,
      csatRating: conversations.csatRating,
    })
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .where(
      and(
        inArray(conversations.id, [...conversationIds]),
        isNull(principal.testOwnerPrincipalId),
      ),
    );

  if (rows.length === 0) return;
  const realIds = rows.map((row) => row.id);
  const channelByConversation = new Map(
    rows.map((row) => [row.id, row.channel]),
  );
  const createdDayByConversation = new Map(
    rows.map((row) => [row.id, utcDay(row.createdAt)]),
  );

  const buckets = new Map<string, DayChannelBucket>();

  for (const row of rows) {
    const day = utcDay(row.createdAt);
    const bucket = getBucket(buckets, day, row.channel);
    bucket.conversationsCreated += 1;
    if (row.resolvedAt) {
      const resolvedBucket = getBucket(
        buckets,
        utcDay(row.resolvedAt),
        row.channel,
      );
      resolvedBucket.conversationsResolved += 1;
    }
    if (typeof row.csatRating === "number") {
      bucket.csatSum += row.csatRating;
      bucket.csatCount += 1;
    }
  }

  const msgCounts = await db
    .select({
      conversationId: conversationMessages.conversationId,
      n: count(),
    })
    .from(conversationMessages)
    .where(
      and(
        inArray(conversationMessages.conversationId, realIds),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .groupBy(conversationMessages.conversationId);

  for (const row of msgCounts) {
    if (!row.conversationId) continue;
    const channel = channelByConversation.get(row.conversationId);
    const day = createdDayByConversation.get(row.conversationId);
    if (!channel || !day) continue;
    getBucket(buckets, day, channel).messagesCount += row.n;
  }

  const slaRows = await db
    .select({
      conversationId: slaEvents.conversationId,
      kind: slaEvents.kind,
      at: slaEvents.at,
    })
    .from(slaEvents)
    .where(inArray(slaEvents.conversationId, realIds));

  for (const row of slaRows) {
    if (!row.conversationId) continue;
    const channel =
      channelByConversation.get(row.conversationId) ?? "messenger";
    const bucket = getBucket(buckets, utcDay(row.at), channel);
    switch (row.kind) {
      case "first_response_met":
        bucket.slaFirstResponseMet += 1;
        break;
      case "first_response_breached":
        bucket.slaFirstResponseBreached += 1;
        break;
      case "next_response_met":
        bucket.slaNextResponseMet += 1;
        break;
      case "next_response_breached":
        bucket.slaNextResponseBreached += 1;
        break;
      case "resolution_met":
        bucket.slaResolutionMet += 1;
        break;
      case "resolution_breached":
        bucket.slaResolutionBreached += 1;
        break;
      case "time_to_resolve_met":
        bucket.slaTimeToResolveMet += 1;
        break;
      case "time_to_resolve_breached":
        bucket.slaTimeToResolveBreached += 1;
        break;
    }
  }

  for (const bucket of buckets.values()) {
    await db
      .insert(supportDailyStats)
      .values({
        day: bucket.day,
        channel: bucket.channel,
        conversationsCreated: bucket.conversationsCreated,
        conversationsResolved: bucket.conversationsResolved,
        messagesCount: bucket.messagesCount,
        slaFirstResponseMet: bucket.slaFirstResponseMet,
        slaFirstResponseBreached: bucket.slaFirstResponseBreached,
        slaNextResponseMet: bucket.slaNextResponseMet,
        slaNextResponseBreached: bucket.slaNextResponseBreached,
        slaResolutionMet: bucket.slaResolutionMet,
        slaResolutionBreached: bucket.slaResolutionBreached,
        slaTimeToResolveMet: bucket.slaTimeToResolveMet,
        slaTimeToResolveBreached: bucket.slaTimeToResolveBreached,
        csatSum: bucket.csatSum,
        csatCount: bucket.csatCount,
      })
      .onConflictDoUpdate({
        target: [
          supportDailyStats.workspaceId,
          supportDailyStats.day,
          supportDailyStats.channel,
        ],
        set: {
          conversationsCreated: sql`${supportDailyStats.conversationsCreated} + ${bucket.conversationsCreated}`,
          conversationsResolved: sql`${supportDailyStats.conversationsResolved} + ${bucket.conversationsResolved}`,
          messagesCount: sql`${supportDailyStats.messagesCount} + ${bucket.messagesCount}`,
          slaFirstResponseMet: sql`${supportDailyStats.slaFirstResponseMet} + ${bucket.slaFirstResponseMet}`,
          slaFirstResponseBreached: sql`${supportDailyStats.slaFirstResponseBreached} + ${bucket.slaFirstResponseBreached}`,
          slaNextResponseMet: sql`${supportDailyStats.slaNextResponseMet} + ${bucket.slaNextResponseMet}`,
          slaNextResponseBreached: sql`${supportDailyStats.slaNextResponseBreached} + ${bucket.slaNextResponseBreached}`,
          slaResolutionMet: sql`${supportDailyStats.slaResolutionMet} + ${bucket.slaResolutionMet}`,
          slaResolutionBreached: sql`${supportDailyStats.slaResolutionBreached} + ${bucket.slaResolutionBreached}`,
          slaTimeToResolveMet: sql`${supportDailyStats.slaTimeToResolveMet} + ${bucket.slaTimeToResolveMet}`,
          slaTimeToResolveBreached: sql`${supportDailyStats.slaTimeToResolveBreached} + ${bucket.slaTimeToResolveBreached}`,
          csatSum: sql`${supportDailyStats.csatSum} + ${bucket.csatSum}`,
          csatCount: sql`${supportDailyStats.csatCount} + ${bucket.csatCount}`,
          updatedAt: new Date(),
        },
      });
  }
}
