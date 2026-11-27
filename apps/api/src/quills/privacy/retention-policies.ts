import { and, asc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  conversationMessages,
  conversationMessageTranslations,
  conversations,
} from "../../database/quills/schema/conversation";
import { conversationSummaries } from "../../database/quills/schema/conversation-summary";
import { files } from "../../database/quills/schema/files";
import { postComments, posts } from "../../database/quills/schema/posts";
import {
  privacyRequests,
  RETENTION_ACTIONS,
  RETENTION_CHANNELS,
  retentionPolicies,
  type RetentionChannel,
} from "../../database/quills/schema/privacy";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { snapshotConversationsIntoDailyStats } from "./stats-snapshot";
import { getOrCreateDeletedPrincipal } from "./tombstone";

const dayLimit = z.number().int().min(1).max(3650).nullable();

export const retentionPolicyItemSchema = z.object({
  id: z.string(),
  channel: z.enum(RETENTION_CHANNELS),
  action: z.enum(RETENTION_ACTIONS),
  closedAfterDays: z.number().int().nullable(),
  spamAfterDays: z.number().int().nullable(),
  softDeletedAfterDays: z.number().int().nullable(),
  aiLogsAfterDays: z.number().int().nullable(),
  updatedByPrincipalId: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

const policyParams = z.object({
  policyId: flexibleToTypeIdSchema("retention_policy"),
});

const upsertPolicyBody = z.object({
  channel: z.enum(RETENTION_CHANNELS),
  action: z.enum(RETENTION_ACTIONS),
  closedAfterDays: dayLimit.default(null),
  spamAfterDays: dayLimit.default(null),
  softDeletedAfterDays: dayLimit.default(null),
  aiLogsAfterDays: dayLimit.default(null),
});

const listPolicies = defineQuillsRoute({
  method: "get",
  path: "/privacy/retention-policies",
  operationId: "listQuillsRetentionPolicies",
  summary: "List workspace retention schedules",
  description:
    "Returns configured retention policies per channel. Channels without an explicit override inherit from the `all` policy when configured.",
  action: "manage_settings",
  response: z.object({
    items: z.array(retentionPolicyItemSchema),
  }),
  responseDescription: "Configured retention schedules",
  handler: async ({ db }) => {
    const rows = await db
      .select()
      .from(retentionPolicies)
      .orderBy(asc(retentionPolicies.channel));
    return { items: rows };
  },
});

const upsertPolicy = defineQuillsRoute({
  method: "put",
  path: "/privacy/retention-policies",
  operationId: "upsertQuillsRetentionPolicy",
  summary: "Create or update a retention schedule for a channel",
  description:
    "Configures automatic retention enforcement for closed conversations, spam, soft-deleted records, and AI logs. Null values disable that category.",
  action: "manage_settings",
  body: upsertPolicyBody,
  response: retentionPolicyItemSchema,
  responseDescription: "The saved retention schedule",
  event: ({ body }, result) => ({
    type: "privacy.retention_updated",
    entityType: "retention_policy",
    entityId: result.id,
    payload: {
      channel: body.channel,
      action: body.action,
    },
  }),
  handler: async ({ db, actor, body }) => {
    const now = new Date();
    const [row] = await db
      .insert(retentionPolicies)
      .values({
        channel: body.channel,
        action: body.action,
        closedAfterDays: body.closedAfterDays,
        spamAfterDays: body.spamAfterDays,
        softDeletedAfterDays: body.softDeletedAfterDays,
        aiLogsAfterDays: body.aiLogsAfterDays,
        updatedByPrincipalId: actor.principalId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [retentionPolicies.workspaceId, retentionPolicies.channel],
        set: {
          action: body.action,
          closedAfterDays: body.closedAfterDays,
          spamAfterDays: body.spamAfterDays,
          softDeletedAfterDays: body.softDeletedAfterDays,
          aiLogsAfterDays: body.aiLogsAfterDays,
          updatedByPrincipalId: actor.principalId,
          updatedAt: now,
        },
      })
      .returning();
    if (!row) throw new Error("Failed to save retention policy");
    return row;
  },
});

const deletePolicy = defineQuillsRoute({
  method: "delete",
  path: "/privacy/retention-policies/{policyId}",
  operationId: "deleteQuillsRetentionPolicy",
  summary: "Remove a retention schedule",
  action: "manage_settings",
  params: policyParams,
  response: z.object({
    id: z.string(),
    channel: z.enum(RETENTION_CHANNELS),
  }),
  responseDescription: "Removed retention schedule",
  errors: { 404: "Retention policy not found" },
  event: ({ params }, result) => ({
    type: "privacy.retention_updated",
    entityType: "retention_policy",
    entityId: params.policyId,
    payload: { channel: result.channel, removed: "true" },
  }),
  handler: async ({ db, params }) => {
    const [deleted] = await db
      .delete(retentionPolicies)
      .where(eq(retentionPolicies.id, params.policyId))
      .returning({
        id: retentionPolicies.id,
        channel: retentionPolicies.channel,
      });
    if (!deleted) {
      throw new HTTPException(404, { message: "Retention policy not found" });
    }
    return deleted;
  },
});

const CONVERSATION_BATCH = 200;
const LOG_BATCH = 1000;

/**
 * Enforces workspace retention schedules in bounded batches inside the hourly retention sweep (#329).
 * Snapshots affected conversations into `quills.support_daily_stats` before purging so historical
 * reporting totals never decrease when eligible threads are deleted.
 */
export async function enforceWorkspaceRetentionPolicies(
  tx: Database,
): Promise<number> {
  let affected = 0;

  // Always clear expired DSAR export keys so the storage trigger queues cleanup.
  const expiredExports = await tx
    .update(privacyRequests)
    .set({ exportS3Key: null })
    .where(
      and(
        isNotNull(privacyRequests.exportS3Key),
        isNotNull(privacyRequests.exportExpiresAt),
        lt(privacyRequests.exportExpiresAt, new Date()),
      ),
    )
    .returning({ id: privacyRequests.id });
  affected += expiredExports.length;

  const policies = await tx.select().from(retentionPolicies);
  if (policies.length === 0) return affected;

  const byChannel = new Map<RetentionChannel, (typeof policies)[number]>(
    policies.map((p) => [p.channel, p]),
  );
  const defaultPolicy = byChannel.get("all");

  // 1. Closed non-spam conversations per channel (messenger, email, widget).
  const conversationChannels = ["messenger", "email", "widget"] as const;
  for (const ch of conversationChannels) {
    const effective = byChannel.get(ch) ?? defaultPolicy;
    if (!effective?.closedAfterDays) continue;

    const cutoff = new Date(
      Date.now() - effective.closedAfterDays * 86_400_000,
    );
    const channelMatch =
      ch === "widget"
        ? and(
            eq(conversations.source, "widget"),
            eq(conversations.channel, "messenger"),
          )
        : ch === "messenger"
          ? and(
              eq(conversations.channel, "messenger"),
              ne(conversations.source, "widget"),
            )
          : eq(conversations.channel, ch);

    const eligible = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          channelMatch,
          eq(conversations.status, "closed"),
          sql`coalesce(${conversations.endReason}, '') <> 'spam'`,
          sql`coalesce(${conversations.resolvedAt}, ${conversations.updatedAt}, ${conversations.createdAt}) < ${cutoff}`,
        ),
      )
      .limit(CONVERSATION_BATCH);

    if (eligible.length === 0) continue;
    const ids = eligible.map((r) => r.id);

    if (effective.action === "delete") {
      await snapshotConversationsIntoDailyStats(tx, ids);
      const msgs = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(inArray(conversationMessages.conversationId, ids));
      if (msgs.length > 0) {
        await tx.delete(files).where(
          inArray(
            files.messageId,
            msgs.map((m) => m.id),
          ),
        );
      }
      const deleted = await tx
        .delete(conversations)
        .where(inArray(conversations.id, ids))
        .returning({ id: conversations.id });
      affected += deleted.length;
    } else {
      const tombstoneId = await getOrCreateDeletedPrincipal(tx);
      const msgs = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(inArray(conversationMessages.conversationId, ids));
      const msgIds = msgs.map((m) => m.id);
      if (msgIds.length > 0) {
        await tx.delete(files).where(inArray(files.messageId, msgIds));
        await tx
          .delete(conversationMessageTranslations)
          .where(
            inArray(
              conversationMessageTranslations.conversationMessageId,
              msgIds,
            ),
          );
        await tx
          .update(conversationMessages)
          .set({
            principalId: tombstoneId,
            content: "[Redacted by retention policy]",
            contentJson: null,
            attachments: null,
            metadata: null,
            redactedAt: new Date(),
            redactionReason: "retention_policy",
            updatedAt: new Date(),
          })
          .where(inArray(conversationMessages.id, msgIds));
      }
      await tx
        .delete(conversationSummaries)
        .where(inArray(conversationSummaries.conversationId, ids));
      const updated = await tx
        .update(conversations)
        .set({
          visitorPrincipalId: tombstoneId,
          visitorEmail: null,
          subject: "[Redacted by retention policy]",
          lastMessagePreview: "[Redacted by retention policy]",
          csatComment: null,
          customAttributes: {},
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(conversations.id, ids),
            ne(conversations.visitorPrincipalId, tombstoneId),
          ),
        )
        .returning({ id: conversations.id });
      affected += updated.length;
    }
  }

  // 2. Spam conversations (uses conversations_spam_resolved_at_idx).
  const spamDays =
    defaultPolicy?.spamAfterDays ??
    policies.find((p) => p.spamAfterDays !== null)?.spamAfterDays ??
    null;
  if (spamDays) {
    const cutoff = new Date(Date.now() - spamDays * 86_400_000);
    const spamRows = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, "closed"),
          eq(conversations.endReason, "spam"),
          lt(conversations.resolvedAt, cutoff),
        ),
      )
      .limit(CONVERSATION_BATCH);
    if (spamRows.length > 0) {
      const spamIds = spamRows.map((r) => r.id);
      const deleted = await tx
        .delete(conversations)
        .where(inArray(conversations.id, spamIds))
        .returning({ id: conversations.id });
      affected += deleted.length;
    }
  }

  // 3. Soft-deleted messages, comments, and posts past grace period.
  const softDays =
    defaultPolicy?.softDeletedAfterDays ??
    policies.find((p) => p.softDeletedAfterDays !== null)
      ?.softDeletedAfterDays ??
    null;
  if (softDays) {
    const cutoff = new Date(Date.now() - softDays * 86_400_000);
    const delMsgs = await tx
      .delete(conversationMessages)
      .where(
        and(
          isNotNull(conversationMessages.deletedAt),
          lt(conversationMessages.deletedAt, cutoff),
        ),
      )
      .returning({ id: conversationMessages.id });
    affected += delMsgs.length;

    const delComments = await tx
      .delete(postComments)
      .where(
        and(
          isNotNull(postComments.deletedAt),
          lt(postComments.deletedAt, cutoff),
        ),
      )
      .returning({ id: postComments.id });
    affected += delComments.length;

    const delPosts = await tx
      .delete(posts)
      .where(and(isNotNull(posts.deletedAt), lt(posts.deletedAt, cutoff)))
      .returning({ id: posts.id });
    affected += delPosts.length;
  }

  // 4. AI tool calls, assistant events, and message translation caches.
  const aiDays =
    defaultPolicy?.aiLogsAfterDays ??
    policies.find((p) => p.aiLogsAfterDays !== null)?.aiLogsAfterDays ??
    null;
  if (aiDays) {
    const cutoff = new Date(Date.now() - aiDays * 86_400_000);
    const toolRes = await tx.execute(
      sql`DELETE FROM quills.assistant_tool_calls WHERE (workspace_id, id) IN (SELECT workspace_id, id FROM quills.assistant_tool_calls WHERE created_at < ${cutoff} ORDER BY created_at LIMIT ${LOG_BATCH})`,
    );
    affected += toolRes.rowCount ?? 0;

    const eventRes = await tx.execute(
      sql`DELETE FROM quills.assistant_events WHERE (workspace_id, id) IN (SELECT workspace_id, id FROM quills.assistant_events WHERE created_at < ${cutoff} ORDER BY created_at LIMIT ${LOG_BATCH})`,
    );
    affected += eventRes.rowCount ?? 0;

    const transRes = await tx.execute(
      sql`DELETE FROM quills.conversation_message_translations WHERE (workspace_id, id) IN (SELECT workspace_id, id FROM quills.conversation_message_translations WHERE created_at < ${cutoff} ORDER BY created_at LIMIT ${LOG_BATCH})`,
    );
    affected += transRes.rowCount ?? 0;
  }

  return affected;
}

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listPolicies)
  .openapi(...upsertPolicy)
  .openapi(...deletePolicy);
