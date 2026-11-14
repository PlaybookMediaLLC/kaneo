import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { principal } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { feedbackSignals } from "../../../database/quills/schema/feedback-signals";
import { hookDeliveries } from "../../../database/quills/schema/hook-deliveries";
import { posts } from "../../../database/quills/schema/posts";
import { tickets } from "../../../database/quills/schema/tickets";
import { exactDistance } from "../../assistant/engine/distance";
import { failedUsage, nothing, type Work } from "../../assistant/engine/shared";
import { aiConfig, chatJson, embed, untrusted } from "../../assistant/provider";
import { logUsage, type UsageEntry } from "../../assistant/runs";
import { recordQuillsChange } from "../../events";
import { pairConversationId } from "../../support/ticket-view";
import type { DeliveryEvent } from "../fanout";
import { claimDelivery, settleDelivery } from "../ledger";

// Feedback autopilot (RFC 0003 feature 1). When a conversation closes or a ticket is resolved,
// the quills.ai queue reads the customer's messages, asks the model for feature requests and bug
// reports, matches each one to a similar post and stores a pending signal for each one.

const MESSAGES = 50;
const CLIP = 1000;
const MAX_SIGNALS = 10;
/** The same cosine rule as listQuillsSimilarPosts, with a floor for a useful match. */
const SIMILARITY = 0.8;

const answer = z.object({
  requests: z.array(
    z.object({
      message: z.number().int(),
      excerpt: z.string(),
      title: z.string(),
    }),
  ),
});

type Source = { conversationId: string | null; ticketId: string | null };

/** The closed conversation or the resolved ticket of the event, and the filter for its messages. */
async function closedSource(db: Database, event: DeliveryEvent) {
  if (event.type === "conversation.status_changed") {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, event.entityId as never),
          eq(conversations.status, "closed"),
          or(
            isNull(conversations.endReason),
            ne(conversations.endReason, "spam"),
          ),
        ),
      );
    return (
      row && {
        source: { conversationId: row.id, ticketId: null } as Source,
        thread: eq(conversationMessages.conversationId, row.id),
      }
    );
  }
  const [row] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(
        eq(tickets.id, event.entityId as never),
        isNull(tickets.deletedAt),
        isNotNull(tickets.resolvedAt),
      ),
    );
  if (!row) return undefined;
  // A customer ticket's thread includes its paired conversation, as the ticket thread route reads it.
  const pair = await pairConversationId(db, row.id);
  return {
    source: { conversationId: null, ticketId: row.id } as Source,
    thread: pair
      ? or(
          eq(conversationMessages.ticketId, row.id),
          eq(conversationMessages.conversationId, pair),
        )!
      : eq(conversationMessages.ticketId, row.id),
  };
}

/**
 * The newest customer messages, oldest first. Only messages that a customer wrote: never a team
 * note, an agent reply, a system notice, a teammate or a test customer.
 */
async function customerMessages(
  db: Database,
  thread: NonNullable<Awaited<ReturnType<typeof closedSource>>>["thread"],
) {
  const rows = await db
    .select({
      id: conversationMessages.id,
      principalId: principal.id,
      content: conversationMessages.content,
    })
    .from(conversationMessages)
    .innerJoin(principal, eq(principal.id, conversationMessages.principalId))
    .where(
      and(
        thread,
        eq(conversationMessages.senderType, "visitor"),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt),
        isNull(principal.kaneoUserId),
        isNull(principal.testOwnerPrincipalId),
        sql`btrim(${conversationMessages.content}) <> ''`,
      ),
    )
    .orderBy(
      desc(conversationMessages.createdAt),
      desc(conversationMessages.id),
    )
    .limit(MESSAGES);
  return rows.reverse();
}

/**
 * conversation.status_changed and ticket.status_changed: extracts signals from a closed
 * conversation or a resolved ticket. Without a provider it does nothing and records nothing.
 *
 * The ledger key names the newest customer message: the same thread is read once, so a retry, a
 * second close event or a ticket and its paired conversation never call the model twice. A
 * thread with a new customer message gets a new key. The unique source message key keeps one
 * signal for each message.
 */
export const extractSignals: Work = async (workspaceId, event) => {
  if (!aiConfig()) return nothing;
  const context = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const found = await closedSource(db, event);
    if (!found) return undefined;
    const messages = await customerMessages(db, found.thread);
    if (!messages.length) return undefined;
    const key = `signals:${messages.at(-1)!.id}`;
    const [done] = await db
      .select({ outcome: hookDeliveries.outcome })
      .from(hookDeliveries)
      .where(eq(hookDeliveries.jobId, key));
    return done?.outcome === "completed"
      ? undefined
      : { source: found.source, messages, key };
  });
  if (!context) return nothing;
  const { source, messages, key } = context;
  const usage: UsageEntry[] = [];
  const extracted = await chatJson(
    answer,
    [
      {
        role: "system",
        content:
          'Find the concrete feature requests and bug reports in these customer messages from a closed support thread. Use only what the customer asked for. Leave out questions, thanks and small talk. For each request, give the number of the message that states it, a short excerpt of the customer\'s words (at most 300 characters) and a short title for a feedback post (at most 80 characters). Answer with one JSON object: {"requests": [{"message": number, "excerpt": string, "title": string}]}. Answer {"requests": []} when there is none.',
      },
      {
        role: "user",
        content: untrusted(
          "messages",
          messages
            .map((row, index) => `[${index + 1}] ${row.content.slice(0, CLIP)}`)
            .join("\n"),
        ),
      },
    ],
    1500,
  );
  usage.push({
    step: "signal_extract",
    callType: "chat_completion",
    usage: extracted.usage,
  });
  // One signal for each message, inside the column bounds.
  const used = new Set<number>();
  const found = extracted.value.requests.flatMap((request) => {
    const message = messages[request.message - 1];
    const excerpt = request.excerpt.trim().slice(0, 2000);
    const title = request.title.trim().slice(0, 200);
    if (!message || used.has(request.message) || !excerpt || !title) return [];
    used.add(request.message);
    return [{ message, excerpt, title }];
  });
  const signals = found.slice(0, MAX_SIGNALS);
  const matches: (string | null)[] = signals.map(() => null);
  // A failed embedding call leaves the signals without a match; it does not repeat the extraction.
  const embedded =
    signals.length && aiConfig()?.embeddingModel
      ? await embed(
          signals.map((signal) => `${signal.title}\n${signal.excerpt}`),
        ).catch((error: unknown) => {
          usage.push(failedUsage("signal_embedding", "embedding", error));
          return undefined;
        })
      : undefined;
  if (embedded) {
    usage.push({
      step: "signal_embedding",
      callType: "embedding",
      usage: embedded.usage,
    });
    await withQuillsSystemWorkspace(workspaceId, async (db) => {
      for (const [index, values] of embedded.vectors.entries()) {
        const distance = exactDistance(
          posts.embedding,
          sql`${JSON.stringify(values)}::vector`,
        );
        const [post] = await db
          .select({ id: posts.id })
          .from(posts)
          .innerJoin(boards, eq(boards.id, posts.boardId))
          .where(
            and(
              isNotNull(posts.embedding),
              isNull(posts.deletedAt),
              isNull(posts.canonicalPostId),
              isNull(boards.deletedAt),
              sql`(1 - ${distance}) >= ${SIMILARITY}`,
            ),
          )
          .orderBy(distance)
          .limit(1);
        matches[index] = post?.id ?? null;
      }
    });
  }
  return async (db) => {
    await logUsage(db, usage);
    if ((await claimDelivery(db, key, "signals")) !== "send") return;
    for (const [index, signal] of signals.entries()) {
      const [row] = await db
        .insert(feedbackSignals)
        .values({
          conversationId: source.conversationId as never,
          ticketId: source.ticketId as never,
          sourceMessageId: signal.message.id,
          principalId: signal.message.principalId,
          excerpt: signal.excerpt,
          suggestedTitle: signal.title,
          matchedPostId: matches[index] as never,
        })
        .onConflictDoNothing()
        .returning({ id: feedbackSignals.id });
      if (row)
        await recordQuillsChange(db, null, {
          type: "signal.created",
          entityType: "feedback_signal",
          entityId: row.id,
          payload: source.conversationId
            ? { conversationId: source.conversationId }
            : { ticketId: source.ticketId! },
        });
    }
    await settleDelivery(db, key, "completed");
  };
};
