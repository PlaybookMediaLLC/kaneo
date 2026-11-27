import { and, eq, inArray, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PrincipalId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { postActivity } from "../../database/quills/schema/activity";
import { assistantEvents } from "../../database/quills/schema/assistant-events";
import { assistantToolCalls } from "../../database/quills/schema/assistant-tool-calls";
import { principal, user } from "../../database/quills/schema/auth";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { channelIdentities } from "../../database/quills/schema/channel-identities";
import {
  conversationMessageFlags,
  conversationMessageMentions,
  conversationMessageReactions,
  conversationMessages,
  conversationMessageTranslations,
  conversationParticipants,
  conversations,
} from "../../database/quills/schema/conversation";
import { conversationSummaries } from "../../database/quills/schema/conversation-summary";
import { emailLog } from "../../database/quills/schema/email-log";
import { files } from "../../database/quills/schema/files";
import { helpCenterArticleFeedback } from "../../database/quills/schema/kb";
import { knowledgeSources } from "../../database/quills/schema/knowledge-suggestions";
import {
  inAppNotifications,
  notificationPreferences,
  postSubscriptions,
  unsubscribeTokens,
} from "../../database/quills/schema/notifications";
import { portalInvites } from "../../database/quills/schema/portal-invites";
import { postMentions } from "../../database/quills/schema/post-mentions";
import {
  postCommentReactions,
  postComments,
  postNotes,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import {
  privacyRequests,
  type PrivacyRequestSummary,
} from "../../database/quills/schema/privacy";
import { pushDevices } from "../../database/quills/schema/push-devices";
import { userSegments } from "../../database/quills/schema/segments";
import { slackUserLinks } from "../../database/quills/schema/slack";
import { statusSubscriptions } from "../../database/quills/schema/status";
import { surveyResponses } from "../../database/quills/schema/surveys";
import { ticketActivity } from "../../database/quills/schema/ticket-activity";
import { ticketSubscriptions } from "../../database/quills/schema/ticket-subscriptions";
import { ticketSummaries } from "../../database/quills/schema/ticket-summary";
import { tickets } from "../../database/quills/schema/tickets";
import { userTagAssignments } from "../../database/quills/schema/user-tags";
import {
  pageViews,
  visitorDevices,
} from "../../database/quills/schema/visitor-analytics";
import { defineQuillsRoute } from "../framework/define-route";
import { snapshotConversationsIntoDailyStats } from "./stats-snapshot";
import { getOrCreateDeletedPrincipal, hashSubjectEmail } from "./tombstone";

export type ErasureMode = "anonymize" | "delete";

export type EraseCustomerOptions = {
  mode: ErasureMode;
  actor: Pick<QuillsActor, "principalId"> | null;
};

export type EraseCustomerResult = {
  requestId: string;
  mode: ErasureMode;
  subjectDigest: string | null;
  status: "completed";
  summary: PrivacyRequestSummary;
  completedAt: Date;
  createdAt: Date;
};

const countRows = (res: { rowCount?: number | null } | unknown[]) =>
  Array.isArray(res) ? res.length : (res.rowCount ?? 0);

/**
 * Erases a customer across every Quills table in a single workspace-scoped transaction (#329).
 * Acquires a per-subject advisory lock, re-attributes or deletes structural records (so
 * ON DELETE RESTRICT FKs never block), clears PII/content/embeddings/files (triggering shared
 * storage cleanup), and stores a non-PII compliance receipt in `quills.privacy_requests`.
 */
export async function eraseCustomerInTx(
  tx: Database,
  subjectPrincipalId: PrincipalId,
  options: EraseCustomerOptions,
): Promise<EraseCustomerResult> {
  // Serialize concurrent erasure/export attempts for this principal inside this transaction.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('quills-privacy-subject'), hashtext(${subjectPrincipalId}))`,
  );

  const [subject] = await tx
    .select({
      id: principal.id,
      userId: principal.userId,
      kaneoUserId: principal.kaneoUserId,
      contactEmail: principal.contactEmail,
      email: user.email,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, subjectPrincipalId))
    .limit(1);

  if (!subject) {
    throw new HTTPException(404, { message: "Customer not found" });
  }
  if (subject.kaneoUserId) {
    throw new HTTPException(409, {
      message:
        "Teammates are managed through workspace membership, not customer erasure",
    });
  }

  const emails = [
    ...new Set(
      [subject.email, subject.contactEmail]
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const emailHash = hashSubjectEmail(emails[0] ?? null);
  const tombstoneId = await getOrCreateDeletedPrincipal(tx);
  const mode = options.mode;

  // Locate every conversation owned by this customer.
  const subjectConversations = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.visitorPrincipalId, subjectPrincipalId));
  const conversationIds = subjectConversations.map((row) => row.id);

  // Locate every ticket requested by this customer.
  const subjectTickets = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.requesterPrincipalId, subjectPrincipalId));
  const ticketIds = subjectTickets.map((row) => row.id);

  // Collect all message IDs owned by the customer or inside the customer's conversations.
  const subjectMessages = await tx
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      conversationIds.length > 0
        ? or(
            eq(conversationMessages.principalId, subjectPrincipalId),
            inArray(conversationMessages.conversationId, conversationIds),
          )
        : eq(conversationMessages.principalId, subjectPrincipalId),
    );
  const messageIds = subjectMessages.map((row) => row.id);

  // 1. Delete files uploaded by the customer or attached to their messages (triggers storage_cleanup).
  const deletedFiles = await tx
    .delete(files)
    .where(
      messageIds.length > 0
        ? or(
            eq(files.uploadedById, subjectPrincipalId),
            inArray(files.messageId, messageIds),
          )
        : eq(files.uploadedById, subjectPrincipalId),
    )
    .returning({ id: files.id });

  // 2. Conversations, messages, translations, summaries, and embeddings.
  let scrubbedConversations = conversationIds.length;
  let scrubbedMessages = messageIds.length;

  if (conversationIds.length > 0) {
    // Clear AI knowledge sources referencing these conversations.
    await tx
      .delete(knowledgeSources)
      .where(inArray(knowledgeSources.conversationId, conversationIds));
    await tx
      .delete(conversationSummaries)
      .where(inArray(conversationSummaries.conversationId, conversationIds));
  }

  // Also remove any summary pointing directly at visitorPrincipalId.
  await tx
    .delete(conversationSummaries)
    .where(eq(conversationSummaries.visitorPrincipalId, subjectPrincipalId));

  if (ticketIds.length > 0) {
    await tx
      .delete(ticketSummaries)
      .where(inArray(ticketSummaries.ticketId, ticketIds));
    await tx
      .update(tickets)
      .set({
        requesterPrincipalId: null,
        title: "[Redacted]",
        updatedAt: new Date(),
      })
      .where(inArray(tickets.id, ticketIds));
  }

  if (messageIds.length > 0) {
    await tx
      .delete(conversationMessageTranslations)
      .where(
        inArray(
          conversationMessageTranslations.conversationMessageId,
          messageIds,
        ),
      );
  }

  if (mode === "delete" && conversationIds.length > 0) {
    // Snapshot immutable support/SLA rollups before deleting conversations so reports stay intact.
    await snapshotConversationsIntoDailyStats(tx, conversationIds);
    const deleted = await tx
      .delete(conversations)
      .where(inArray(conversations.id, conversationIds))
      .returning({ id: conversations.id });
    scrubbedConversations = deleted.length;
    // Re-attribute any residual messages authored by the subject on other threads.
    await tx
      .update(conversationMessages)
      .set({
        principalId: tombstoneId,
        content: "[Redacted]",
        contentJson: null,
        attachments: null,
        metadata: null,
        redactedAt: new Date(),
        redactedByPrincipalId: options.actor?.principalId ?? null,
        redactionReason: "customer_erasure",
        updatedAt: new Date(),
      })
      .where(eq(conversationMessages.principalId, subjectPrincipalId));
  } else {
    if (messageIds.length > 0) {
      await tx
        .update(conversationMessages)
        .set({
          content: "[Redacted]",
          contentJson: null,
          attachments: null,
          metadata: null,
          redactedAt: new Date(),
          redactedByPrincipalId: options.actor?.principalId ?? null,
          redactionReason: "customer_erasure",
          updatedAt: new Date(),
        })
        .where(inArray(conversationMessages.id, messageIds));
    }
    await tx
      .update(conversationMessages)
      .set({ principalId: tombstoneId })
      .where(eq(conversationMessages.principalId, subjectPrincipalId));

    if (conversationIds.length > 0) {
      await tx
        .update(conversations)
        .set({
          visitorPrincipalId: tombstoneId,
          visitorEmail: null,
          subject: "[Redacted]",
          lastMessagePreview: "[Redacted]",
          csatComment: null,
          customAttributes: {},
          updatedAt: new Date(),
        })
        .where(inArray(conversations.id, conversationIds));
    }
  }

  // 3. Feedback posts, comments, votes, notes, mentions, reactions.
  let postsAffected = 0;
  let commentsAffected = 0;
  let votesAffected = 0;

  if (mode === "delete") {
    const delComments = await tx
      .delete(postComments)
      .where(eq(postComments.principalId, subjectPrincipalId))
      .returning({ id: postComments.id });
    commentsAffected = delComments.length;

    const delVotes = await tx
      .delete(postVotes)
      .where(eq(postVotes.principalId, subjectPrincipalId))
      .returning({ id: postVotes.id });
    votesAffected = delVotes.length;

    const delPosts = await tx
      .delete(posts)
      .where(eq(posts.principalId, subjectPrincipalId))
      .returning({ id: posts.id });
    postsAffected = delPosts.length;
  } else {
    // Re-attribute posts/comments/votes to the tombstone principal while removing personal text.
    const updComments = await tx
      .update(postComments)
      .set({
        principalId: tombstoneId,
        content: "[Redacted]",
        contentJson: null,
        updatedAt: new Date(),
      })
      .where(eq(postComments.principalId, subjectPrincipalId))
      .returning({ id: postComments.id });
    commentsAffected = updComments.length;

    // Preserve aggregate vote counts: remove only votes that would collide with an existing
    // tombstone vote on the same post, then re-attribute the rest.
    const subjectVotes = await tx
      .select({ id: postVotes.id, postId: postVotes.postId })
      .from(postVotes)
      .where(eq(postVotes.principalId, subjectPrincipalId));
    votesAffected = subjectVotes.length;
    if (subjectVotes.length > 0) {
      const existingTombstoneVotes = await tx
        .select({ postId: postVotes.postId })
        .from(postVotes)
        .where(
          and(
            eq(postVotes.principalId, tombstoneId),
            inArray(
              postVotes.postId,
              subjectVotes.map((v) => v.postId),
            ),
          ),
        );
      const collidingPosts = new Set(
        existingTombstoneVotes.map((row) => row.postId),
      );
      const toDelete = subjectVotes
        .filter((v) => collidingPosts.has(v.postId))
        .map((v) => v.id);
      if (toDelete.length > 0) {
        await tx.delete(postVotes).where(inArray(postVotes.id, toDelete));
      }
      await tx
        .update(postVotes)
        .set({ principalId: tombstoneId })
        .where(eq(postVotes.principalId, subjectPrincipalId));
    }

    const updPosts = await tx
      .update(posts)
      .set({
        principalId: tombstoneId,
        content: "[Redacted]",
        contentJson: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.principalId, subjectPrincipalId))
      .returning({ id: posts.id });
    postsAffected = updPosts.length;
  }

  // 4. Clean up all peripheral customer-linked records & logs.
  await tx
    .delete(postCommentReactions)
    .where(eq(postCommentReactions.principalId, subjectPrincipalId));
  await tx
    .delete(postMentions)
    .where(eq(postMentions.principalId, subjectPrincipalId));
  await tx
    .delete(postNotes)
    .where(eq(postNotes.principalId, subjectPrincipalId));
  await tx
    .delete(postActivity)
    .where(eq(postActivity.principalId, subjectPrincipalId));
  await tx
    .delete(ticketActivity)
    .where(eq(ticketActivity.principalId, subjectPrincipalId));
  await tx
    .delete(conversationParticipants)
    .where(eq(conversationParticipants.principalId, subjectPrincipalId));
  await tx
    .delete(conversationMessageMentions)
    .where(eq(conversationMessageMentions.principalId, subjectPrincipalId));
  await tx
    .delete(conversationMessageReactions)
    .where(eq(conversationMessageReactions.principalId, subjectPrincipalId));
  await tx
    .delete(conversationMessageFlags)
    .where(eq(conversationMessageFlags.principalId, subjectPrincipalId));

  await tx
    .delete(channelIdentities)
    .where(eq(channelIdentities.principalId, subjectPrincipalId));
  await tx
    .delete(slackUserLinks)
    .where(eq(slackUserLinks.principalId, subjectPrincipalId));
  await tx
    .delete(pushDevices)
    .where(eq(pushDevices.principalId, subjectPrincipalId));
  await tx
    .delete(visitorDevices)
    .where(eq(visitorDevices.principalId, subjectPrincipalId));
  await tx
    .delete(userSegments)
    .where(eq(userSegments.principalId, subjectPrincipalId));
  await tx
    .delete(userTagAssignments)
    .where(eq(userTagAssignments.principalId, subjectPrincipalId));
  await tx
    .delete(notificationPreferences)
    .where(eq(notificationPreferences.principalId, subjectPrincipalId));
  await tx
    .delete(inAppNotifications)
    .where(eq(inAppNotifications.principalId, subjectPrincipalId));
  await tx
    .delete(unsubscribeTokens)
    .where(eq(unsubscribeTokens.principalId, subjectPrincipalId));

  const sub1 = await tx
    .delete(postSubscriptions)
    .where(eq(postSubscriptions.principalId, subjectPrincipalId))
    .returning({ id: postSubscriptions.id });
  const sub2 = await tx
    .delete(changelogSubscriptions)
    .where(eq(changelogSubscriptions.principalId, subjectPrincipalId))
    .returning({ id: changelogSubscriptions.id });
  const sub3 = await tx
    .delete(ticketSubscriptions)
    .where(eq(ticketSubscriptions.principalId, subjectPrincipalId))
    .returning({ id: ticketSubscriptions.id });
  const sub4 = await tx
    .delete(statusSubscriptions)
    .where(eq(statusSubscriptions.principalId, subjectPrincipalId))
    .returning({ id: statusSubscriptions.id });

  if (emails.length > 0) {
    for (const address of emails) {
      await tx
        .delete(portalInvites)
        .where(sql`lower(${portalInvites.email}) = ${address}`);
    }
  }

  const delSurveys = await tx
    .delete(surveyResponses)
    .where(eq(surveyResponses.principalId, subjectPrincipalId))
    .returning({ id: surveyResponses.id });

  await tx
    .delete(helpCenterArticleFeedback)
    .where(eq(helpCenterArticleFeedback.principalId, subjectPrincipalId));
  await tx
    .update(pageViews)
    .set({ principalId: null })
    .where(eq(pageViews.principalId, subjectPrincipalId));

  // AI & email logs linked to the subject or their conversations.
  let aiLogsRemoved = 0;
  const delToolCalls = await tx
    .delete(assistantToolCalls)
    .where(
      conversationIds.length > 0
        ? or(
            eq(assistantToolCalls.principalId, subjectPrincipalId),
            inArray(assistantToolCalls.conversationId, conversationIds),
          )
        : eq(assistantToolCalls.principalId, subjectPrincipalId),
    )
    .returning({ id: assistantToolCalls.id });
  aiLogsRemoved += delToolCalls.length;

  const delAssistantEvents = await tx
    .delete(assistantEvents)
    .where(
      conversationIds.length > 0
        ? or(
            eq(assistantEvents.principalId, subjectPrincipalId),
            inArray(assistantEvents.conversationId, conversationIds),
          )
        : eq(assistantEvents.principalId, subjectPrincipalId),
    )
    .returning({ id: assistantEvents.id });
  aiLogsRemoved += delAssistantEvents.length;

  const emailLogConditions = [eq(emailLog.principalId, subjectPrincipalId)];
  if (conversationIds.length > 0) {
    emailLogConditions.push(inArray(emailLog.conversationId, conversationIds));
  }
  for (const address of emails) {
    emailLogConditions.push(sql`lower(${emailLog.address}) = ${address}`);
  }
  const delEmailLogs = await tx
    .delete(emailLog)
    .where(or(...emailLogConditions))
    .returning({ id: emailLog.id });

  // 5. Delete the principal and customer_identity rows (triggers storage cleanup for avatar_key & image_key).
  await tx.delete(principal).where(eq(principal.id, subjectPrincipalId));
  if (subject.userId) {
    await tx.delete(user).where(eq(user.id, subject.userId));
  }

  const summary: PrivacyRequestSummary = {
    mode,
    conversations: scrubbedConversations,
    messages: scrubbedMessages,
    files: deletedFiles.length,
    posts: postsAffected,
    comments: commentsAffected,
    votes: votesAffected,
    tickets: ticketIds.length,
    surveyResponses: delSurveys.length,
    aiLogs: aiLogsRemoved,
    emailLogs: countRows(delEmailLogs),
    subscriptions: sub1.length + sub2.length + sub3.length + sub4.length,
  };

  const completedAt = new Date();
  const [receipt] = await tx
    .insert(privacyRequests)
    .values({
      type: "erasure",
      mode,
      subjectPrincipalId: null,
      subjectEmailHash: emailHash,
      status: "completed",
      requestedByPrincipalId: options.actor?.principalId ?? null,
      summary,
      completedAt,
    })
    .returning({
      id: privacyRequests.id,
      createdAt: privacyRequests.createdAt,
    });

  if (!receipt) throw new Error("Failed to record erasure receipt");

  return {
    requestId: receipt.id,
    mode,
    subjectDigest: emailHash,
    status: "completed",
    summary,
    completedAt,
    createdAt: receipt.createdAt,
  };
}

export const privacySummarySchema = z.object({
  mode: z.enum(["anonymize", "delete"]).optional(),
  conversations: z.number().int().min(0).optional(),
  messages: z.number().int().min(0).optional(),
  files: z.number().int().min(0).optional(),
  posts: z.number().int().min(0).optional(),
  comments: z.number().int().min(0).optional(),
  votes: z.number().int().min(0).optional(),
  tickets: z.number().int().min(0).optional(),
  surveyResponses: z.number().int().min(0).optional(),
  aiLogs: z.number().int().min(0).optional(),
  emailLogs: z.number().int().min(0).optional(),
  subscriptions: z.number().int().min(0).optional(),
  exportBytes: z.number().int().min(0).optional(),
  attachmentCount: z.number().int().min(0).optional(),
});

export const privacyRequestItemSchema = z.object({
  id: z.string(),
  type: z.enum(["erasure", "access"]),
  mode: z.enum(["anonymize", "delete"]).nullable(),
  subjectPrincipalId: z.string().nullable(),
  subjectDigest: z.string().nullable(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  requestedByPrincipalId: z.string().nullable(),
  summary: privacySummarySchema,
  exportFileName: z.string().nullable(),
  exportExpiresAt: nullableResponseTimestamp,
  error: z.string().nullable(),
  completedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
});

const eraseCustomerRoute = defineQuillsRoute({
  method: "post",
  path: "/privacy/erasure",
  operationId: "eraseQuillsCustomer",
  summary: "Erase a customer's personal data across Quills",
  description:
    "Requires quills:manage_settings. Removes the customer's PII, attachments, embeddings, logs, and sessions in one transaction, returning a non-PII compliance receipt.",
  action: "manage_settings",
  body: z.object({
    principalId: flexibleToTypeIdSchema("principal"),
    mode: z.enum(["anonymize", "delete"]).default("anonymize"),
  }),
  response: z.object({
    requestId: z.string(),
    mode: z.enum(["anonymize", "delete"]),
    subjectDigest: z.string().nullable(),
    status: z.literal("completed"),
    summary: privacySummarySchema,
    completedAt: responseTimestamp,
    createdAt: responseTimestamp,
  }),
  responseDescription: "Non-PII compliance receipt for the erased customer",
  errors: {
    404: "Customer not found",
    409: "Teammates cannot be erased through customer erasure",
  },
  event: (_input, result) => ({
    type: "privacy.customer_erased",
    entityType: "privacy_request",
    entityId: result.requestId,
    payload: {
      mode: result.mode,
      conversations: String(result.summary.conversations ?? 0),
      messages: String(result.summary.messages ?? 0),
      files: String(result.summary.files ?? 0),
    },
  }),
  handler: async ({ db: tx, actor, body }) => {
    return eraseCustomerInTx(tx, body.principalId, {
      mode: body.mode,
      actor,
    });
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...eraseCustomerRoute,
);
