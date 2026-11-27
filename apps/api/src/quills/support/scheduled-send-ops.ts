// Route-module helper: framework/boundaries.test.ts checks its imports via ../framework/define-route.
import { createId, type TypeId } from "@kaneo/ids";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { files } from "../../database/quills/schema/files";
import { jobQueue } from "../../database/quills/schema/job-queue";
import { tickets } from "../../database/quills/schema/tickets";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  conflict,
  findConversation,
  notFound,
  preview,
  type ConversationId,
} from "./conversation-model";
import { reopened } from "./conversation-ops";
import { readUndoSend } from "./support-settings";
import { lockedLinkedTickets, lockTickets } from "./ticket-lifecycle";
import { pairConversationId, subscribe } from "./ticket-view";

const MAX_SCHEDULE_DAYS = 30;
export const SCHEDULED_SEND_QUEUE = "quills.workflow" as const;

export const scheduledDedupeKey = (messageId: string) =>
  `scheduled-send:${messageId}`;

/**
 * Resolves whether a reply should be held/scheduled and returns its target send timestamp,
 * or null when it should send immediately (#323).
 */
export async function resolveScheduledSendAt(
  db: Database,
  input: { scheduledAt?: Date; delaySeconds?: number },
): Promise<Date | null> {
  const now = Date.now();
  if (input.scheduledAt) {
    const target = input.scheduledAt.getTime();
    if (target <= now) {
      throw new HTTPException(400, {
        message: "Scheduled send time must be in the future",
      });
    }
    if (target - now > MAX_SCHEDULE_DAYS * 86_400_000) {
      throw new HTTPException(400, {
        message: `Replies can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead`,
      });
    }
    return input.scheduledAt;
  }
  if (input.delaySeconds === 0) return null;
  if (input.delaySeconds !== undefined) {
    return new Date(now + input.delaySeconds * 1000);
  }
  const setting = await readUndoSend(db);
  if (!setting.enabled) return null;
  return new Date(now + setting.delaySeconds * 1000);
}

/** Enqueues a delayed release job on `quills.workflow` inside the caller's transaction. */
export async function enqueueScheduledSendJob(
  db: Database,
  messageId: string,
  scheduledSendAt: Date,
  extra: { ticketId?: string; replyAll?: boolean } = {},
) {
  await db
    .insert(jobQueue)
    .values({
      jobId: createId("job"),
      queue: SCHEDULED_SEND_QUEUE,
      payload: {
        scheduledMessageId: messageId,
        ...(extra.ticketId && { ticketId: extra.ticketId }),
        ...(extra.replyAll && { replyAll: "true" }),
      },
      dedupeKey: scheduledDedupeKey(messageId),
      maxAttempts: 5,
      runAt: scheduledSendAt,
    })
    .onConflictDoNothing();
}

export interface ReleasedScheduledMessage {
  released: boolean;
  messageId: string;
  conversationId: ConversationId | null;
  ticketId: TypeId<"ticket"> | null;
  principalId: TypeId<"principal"> | null;
  replyAll: boolean;
}

/**
 * Atomically releases a still-scheduled message under a row lock (`FOR UPDATE`).
 * If the message was already recalled or sent, returns `{ released: false }` with zero writes.
 */
export async function releaseScheduledMessage(
  db: Database,
  messageId: TypeId<"conversation_msg">,
  options: { ticketId?: TypeId<"ticket">; replyAll?: boolean } = {},
): Promise<ReleasedScheduledMessage> {
  const [row] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .for("update")
    .limit(1);
  if (!row || row.deletedAt || row.sendStatus !== "scheduled") {
    return {
      released: false,
      messageId,
      conversationId: row?.conversationId ?? null,
      ticketId: row?.ticketId ?? options.ticketId ?? null,
      principalId: row?.principalId ?? null,
      replyAll: Boolean(options.replyAll),
    };
  }

  const now = new Date();
  await db
    .update(conversationMessages)
    .set({
      sendStatus: "sent",
      createdAt: now,
      updatedAt: now,
    })
    .where(eq(conversationMessages.id, row.id));

  // Cancel any still-pending scheduled-send job (used when releasing via Send Now) and recover
  // its ticketId / replyAll flags so paired customer tickets & tracker reply-all behave identically.
  const deletedJobs = await db
    .delete(jobQueue)
    .where(
      and(
        eq(jobQueue.queue, SCHEDULED_SEND_QUEUE),
        eq(jobQueue.dedupeKey, scheduledDedupeKey(row.id)),
        eq(jobQueue.status, "pending"),
      ),
    )
    .returning({ payload: jobQueue.payload });
  const jobPayload = deletedJobs[0]?.payload as
    | { ticketId?: string; replyAll?: boolean | string }
    | undefined;
  const effectiveReplyAll = Boolean(
    options.replyAll ??
    (jobPayload?.replyAll === true || jobPayload?.replyAll === "true"),
  );
  const targetTicketId =
    options.ticketId ??
    row.ticketId ??
    (typeof jobPayload?.ticketId === "string"
      ? (jobPayload.ticketId as TypeId<"ticket">)
      : null);

  if (row.conversationId) {
    const conversation = await findConversation(db, row.conversationId, true);
    const status =
      conversation.status === "closed" ? "open" : conversation.status;
    await db
      .update(conversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: preview(row.content),
        agentLastReadAt: now,
        assignedAgentPrincipalId:
          conversation.assignedAgentPrincipalId ?? row.principalId,
        firstResponseAt: conversation.firstResponseAt ?? now,
        status,
        ...reopened(conversation, status),
        resolvedAt: null,
        waitingSince: null,
        solutionOfferedAt: null,
        autoCloseAt: null,
        closeReminderSentAt: null,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
  }

  if (targetTicketId) {
    const locked = await lockTickets(db, [targetTicketId], effectiveReplyAll);
    const ticket = locked.find((t) => t.id === targetTicketId);
    if (ticket) {
      await db
        .update(tickets)
        .set({
          updatedAt: now,
          ...(!row.conversationId &&
            !ticket.firstResponseAt && { firstResponseAt: now }),
        })
        .where(eq(tickets.id, ticket.id));
      if (row.principalId) {
        await subscribe(db, ticket.id, row.principalId, "replier");
      }
      if (effectiveReplyAll && ticket.type === "tracker" && row.principalId) {
        for (const linked of await lockedLinkedTickets(db, ticket.id)) {
          const linkedPair =
            linked.type === "customer"
              ? await pairConversationId(db, linked.id)
              : null;
          const copyMeta = {
            repliedAllFromTicketId: ticket.id,
            repliedAllFromMessageId: row.id,
          };
          if (linkedPair) {
            const conv = await findConversation(db, linkedPair, true);
            await db.insert(conversationMessages).values({
              conversationId: conv.id,
              principalId: row.principalId,
              senderType: "agent",
              content: row.content,
              metadata: copyMeta,
              createdAt: now,
            });
            await db
              .update(conversations)
              .set({
                lastMessageAt: now,
                lastMessagePreview: preview(row.content),
                agentLastReadAt: now,
                firstResponseAt: conv.firstResponseAt ?? now,
                waitingSince: null,
                solutionOfferedAt: null,
                autoCloseAt: null,
                closeReminderSentAt: null,
                updatedAt: now,
              })
              .where(eq(conversations.id, conv.id));
          } else {
            await db.insert(conversationMessages).values({
              ticketId: linked.id,
              principalId: row.principalId,
              senderType: "agent",
              content: row.content,
              metadata: copyMeta,
              createdAt: now,
            });
          }
          await db
            .update(tickets)
            .set({
              updatedAt: now,
              ...(!linkedPair &&
                !linked.firstResponseAt && { firstResponseAt: now }),
            })
            .where(eq(tickets.id, linked.id));
        }
      }
    }
  }

  return {
    released: true,
    messageId: row.id,
    conversationId: row.conversationId,
    ticketId: targetTicketId,
    principalId: row.principalId,
    replyAll: effectiveReplyAll,
  };
}

/**
 * Recalls a scheduled reply before it sends (#323). Locks the message row `FOR UPDATE` so it
 * cannot race with the worker. Returns the recalled content & attachment IDs so the composer
 * can restore the draft.
 */
export async function recallScheduledMessage(
  db: Database,
  actor: QuillsActor,
  canManage: boolean,
  messageId: TypeId<"conversation_msg">,
) {
  const [row] = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, messageId),
        sql`${conversationMessages.deletedAt} IS NULL`,
      ),
    )
    .for("update")
    .limit(1);
  if (!row) throw notFound("Message");
  if (row.principalId !== actor.principalId && !canManage) {
    throw new HTTPException(403, {
      message:
        "Only the sender or a workspace admin can recall a scheduled reply",
    });
  }
  if (row.sendStatus === "sent") {
    throw conflict("This reply was already sent and can no longer be undone");
  }
  const attachmentIds = (row.attachments ?? [])
    .map((item) => item.fileId)
    .filter((id): id is string => typeof id === "string");
  if (row.sendStatus === "recalled") {
    return {
      recalled: true as const,
      changed: false,
      messageId: row.id,
      conversationId: row.conversationId,
      ticketId: row.ticketId,
      content: row.content,
      attachmentIds,
    };
  }

  const now = new Date();
  await db
    .update(conversationMessages)
    .set({
      sendStatus: "recalled",
      attachments: [],
      recalledAt: now,
      recalledByPrincipalId: actor.principalId,
      updatedAt: now,
    })
    .where(eq(conversationMessages.id, row.id));

  await db
    .delete(jobQueue)
    .where(
      and(
        eq(jobQueue.queue, SCHEDULED_SEND_QUEUE),
        eq(jobQueue.dedupeKey, scheduledDedupeKey(row.id)),
        eq(jobQueue.status, "pending"),
      ),
    );

  // Detach any files so the teammate can re-attach them cleanly when editing the restored draft.
  await db
    .update(files)
    .set({ messageId: null, attachedAt: null })
    .where(eq(files.messageId, row.id));

  return {
    recalled: true as const,
    changed: true,
    messageId: row.id,
    conversationId: row.conversationId,
    ticketId: row.ticketId,
    content: row.content,
    attachmentIds,
  };
}
