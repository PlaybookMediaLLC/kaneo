import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversationParticipants,
  conversations,
  conversationTagAssignments,
} from "../../database/quills/schema/conversation";
import { files } from "../../database/quills/schema/files";
import {
  supportMergeRecords,
  type SupportMergeSnapshot,
} from "../../database/quills/schema/support-merges";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import { ticketSubscriptions } from "../../database/quills/schema/ticket-subscriptions";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { findConversation, preview } from "./conversation-model";

// Reversible conversation and ticket merges (#322):
// - Preview detects cross-requester and cross-company merges, message & attachment counts.
// - Merge requires explicit confirmCrossRequester / confirmCrossCompany flags when crossing
//   requester or company boundaries (409 otherwise).
// - Silent to customers by default (notifyRequester defaults to false).
// - Moves conversation_messages cleanly (preserving files.messageId attachments automatically).
// - Stores complete snapshot in quills.support_merge_records so Undo restores byte-for-byte.

const mergeRecordSchema = z.object({
  id: z.string(),
  entityKind: z.enum(["conversation", "ticket"]),
  sourceId: z.string(),
  targetId: z.string(),
  crossRequester: z.boolean(),
  crossCompany: z.boolean(),
  notifyRequester: z.boolean(),
  mergedByPrincipalId: z.string().nullable(),
  undoneAt: nullableResponseTimestamp,
  undoneByPrincipalId: z.string().nullable(),
  createdAt: responseTimestamp,
});

const mergeParams = z.object({ mergeId: z.string().uuid() });

async function refreshConversationSummary(
  db: Database,
  conversationId: string,
) {
  const [latest] = await db
    .select({
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId as never),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .orderBy(
      desc(conversationMessages.createdAt),
      desc(conversationMessages.id),
    )
    .limit(1);
  await db
    .update(conversations)
    .set({
      ...(latest ? { lastMessageAt: latest.createdAt } : {}),
      lastMessagePreview: latest ? preview(latest.content) : null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId as never));
}

async function principalCompany(
  db: Database,
  principalId: string | null | undefined,
): Promise<string | null> {
  if (!principalId) return null;
  const [row] = await db
    .select({ companyId: principal.companyId })
    .from(principal)
    .where(eq(principal.id, principalId as never))
    .limit(1);
  return row?.companyId ?? null;
}

/** Performs one reversible conversation merge inside the caller's transaction. */
async function mergeOneConversation(
  db: Database,
  actorPrincipalId: string | null,
  sourceId: string,
  targetId: string,
  opts: {
    confirmCrossRequester: boolean;
    confirmCrossCompany: boolean;
    notifyRequester: boolean;
  },
) {
  if (sourceId === targetId) {
    throw new HTTPException(400, {
      message: "Cannot merge a conversation into itself",
    });
  }
  const source = await findConversation(db, sourceId as never, true);
  const target = await findConversation(db, targetId as never, true);

  if (source.mergedIntoConversationId) {
    throw new HTTPException(409, {
      message: "Source conversation is already merged",
    });
  }
  if (target.mergedIntoConversationId) {
    throw new HTTPException(409, {
      message: "Target conversation is already merged",
    });
  }

  const crossRequester =
    source.visitorPrincipalId !== target.visitorPrincipalId;
  const sourceCompany = await principalCompany(db, source.visitorPrincipalId);
  const targetCompany = await principalCompany(db, target.visitorPrincipalId);
  const crossCompany =
    sourceCompany !== null &&
    targetCompany !== null &&
    sourceCompany !== targetCompany;

  if (crossRequester && !opts.confirmCrossRequester) {
    throw new HTTPException(409, {
      message:
        "Conversations belong to different requesters; set confirmCrossRequester=true to confirm",
    });
  }
  if (crossCompany && !opts.confirmCrossCompany) {
    throw new HTTPException(409, {
      message:
        "Conversations belong to different companies; set confirmCrossCompany=true to confirm",
    });
  }

  // Move all messages from source -> target (files.messageId follows automatically)
  const movedMsgs = await db
    .update(conversationMessages)
    .set({ conversationId: target.id })
    .where(eq(conversationMessages.conversationId, source.id))
    .returning({ id: conversationMessages.id });

  // Copy tags that target does not already have
  const sourceTags = await db
    .select({ tagId: conversationTagAssignments.conversationTagId })
    .from(conversationTagAssignments)
    .where(eq(conversationTagAssignments.conversationId, source.id));
  const targetTags = new Set(
    (
      await db
        .select({ tagId: conversationTagAssignments.conversationTagId })
        .from(conversationTagAssignments)
        .where(eq(conversationTagAssignments.conversationId, target.id))
    ).map((r) => r.tagId),
  );
  const addedTagIds: string[] = [];
  for (const { tagId } of sourceTags) {
    if (!targetTags.has(tagId)) {
      await db
        .insert(conversationTagAssignments)
        .values({ conversationId: target.id, conversationTagId: tagId })
        .onConflictDoNothing();
      addedTagIds.push(tagId);
    }
  }

  // Copy participants that target does not already have
  const sourceParts = await db
    .select({ principalId: conversationParticipants.principalId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, source.id));
  const targetParts = new Set(
    (
      await db
        .select({ principalId: conversationParticipants.principalId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, target.id))
    ).map((r) => r.principalId),
  );
  const addedParticipantIds: string[] = [];
  for (const { principalId } of sourceParts) {
    if (!targetParts.has(principalId)) {
      await db
        .insert(conversationParticipants)
        .values({ conversationId: target.id, principalId })
        .onConflictDoNothing();
      addedParticipantIds.push(principalId);
    }
  }

  // Insert internal audit notices (silent to customers unless notifyRequester=true)
  const [targetNotice] = await db
    .insert(conversationMessages)
    .values({
      conversationId: target.id,
      principalId: null,
      senderType: "system",
      isInternal: !opts.notifyRequester,
      content: `Merged conversation ${source.id} into this conversation (${movedMsgs.length} messages moved).`,
      metadata: {
        mergeAudit: {
          kind: "conversation",
          sourceId: source.id,
          targetId: target.id,
        },
      } as never,
    })
    .returning({ id: conversationMessages.id });

  const [sourceNotice] = await db
    .insert(conversationMessages)
    .values({
      conversationId: source.id,
      principalId: null,
      senderType: "system",
      isInternal: !opts.notifyRequester,
      content: `This conversation was merged into ${target.id}.`,
      metadata: {
        mergeAudit: {
          kind: "conversation",
          sourceId: source.id,
          targetId: target.id,
        },
      } as never,
    })
    .returning({ id: conversationMessages.id });

  const now = new Date();
  const snapshot: SupportMergeSnapshot = {
    movedMessageIds: movedMsgs.map((m) => m.id),
    addedTagIds,
    addedParticipantIds,
    targetNoticeMessageId: targetNotice?.id ?? null,
    sourceNoticeMessageId: sourceNotice?.id ?? null,
    sourceBefore: {
      status: source.status,
      resolvedAt: source.resolvedAt?.toISOString() ?? null,
      endReason: source.endReason ?? null,
      endNote: source.endNote ?? null,
      archivedAt: source.archivedAt?.toISOString() ?? null,
    },
  };

  await db
    .update(conversations)
    .set({
      status: "closed",
      endReason: "merged",
      resolvedAt: now,
      mergedIntoConversationId: target.id,
      mergedAt: now,
      updatedAt: now,
    })
    .where(eq(conversations.id, source.id));

  await refreshConversationSummary(db, target.id);

  const [record] = await db
    .insert(supportMergeRecords)
    .values({
      entityKind: "conversation",
      sourceId: source.id,
      targetId: target.id,
      crossRequester,
      crossCompany,
      notifyRequester: opts.notifyRequester,
      mergedByPrincipalId: actorPrincipalId as never,
      snapshot,
    })
    .returning({
      id: supportMergeRecords.id,
      entityKind: supportMergeRecords.entityKind,
      sourceId: supportMergeRecords.sourceId,
      targetId: supportMergeRecords.targetId,
      crossRequester: supportMergeRecords.crossRequester,
      crossCompany: supportMergeRecords.crossCompany,
      notifyRequester: supportMergeRecords.notifyRequester,
      mergedByPrincipalId: supportMergeRecords.mergedByPrincipalId,
      undoneAt: supportMergeRecords.undoneAt,
      undoneByPrincipalId: supportMergeRecords.undoneByPrincipalId,
      createdAt: supportMergeRecords.createdAt,
    });

  return record!;
}

async function undoOneConversationMerge(
  db: Database,
  actorPrincipalId: string | null,
  mergeId: string,
) {
  const [row] = await db
    .select()
    .from(supportMergeRecords)
    .where(
      and(
        eq(supportMergeRecords.id, mergeId),
        eq(supportMergeRecords.entityKind, "conversation"),
      ),
    )
    .for("update");
  if (!row) throw new HTTPException(404, { message: "Merge record not found" });
  if (row.undoneAt) {
    throw new HTTPException(409, { message: "Merge was already undone" });
  }
  const lockedIds = [row.sourceId, row.targetId].sort();
  const lockedConvs = await db
    .select({
      id: conversations.id,
      mergedInto: conversations.mergedIntoConversationId,
    })
    .from(conversations)
    .where(inArray(conversations.id, lockedIds as never[]))
    .orderBy(conversations.id)
    .for("update");
  const targetRow = lockedConvs.find((c) => c.id === row.targetId);
  const sourceRow = lockedConvs.find((c) => c.id === row.sourceId);
  if (targetRow?.mergedInto) {
    throw new HTTPException(409, {
      message: "Undo the later merge on the target conversation first",
    });
  }
  if (
    sourceRow &&
    sourceRow.mergedInto &&
    sourceRow.mergedInto !== row.targetId
  ) {
    throw new HTTPException(409, {
      message: "Source conversation is now merged into a different target",
    });
  }

  const snap = row.snapshot;
  // Move messages back to source conversation (attachments follow automatically)
  if (snap.movedMessageIds.length) {
    await db
      .update(conversationMessages)
      .set({ conversationId: row.sourceId as never })
      .where(
        and(
          eq(conversationMessages.conversationId, row.targetId as never),
          inArray(conversationMessages.id, snap.movedMessageIds as never[]),
        ),
      );
  }
  // Remove merge audit notices
  const noticeIds = [
    snap.targetNoticeMessageId,
    snap.sourceNoticeMessageId,
  ].filter((x): x is string => Boolean(x));
  if (noticeIds.length) {
    await db
      .delete(conversationMessages)
      .where(inArray(conversationMessages.id, noticeIds as never[]));
  }
  // Remove tags & participants that were newly added during merge
  if (snap.addedTagIds?.length) {
    await db
      .delete(conversationTagAssignments)
      .where(
        and(
          eq(conversationTagAssignments.conversationId, row.targetId as never),
          inArray(
            conversationTagAssignments.conversationTagId,
            snap.addedTagIds as never[],
          ),
        ),
      );
  }
  if (snap.addedParticipantIds?.length) {
    await db
      .delete(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, row.targetId as never),
          inArray(
            conversationParticipants.principalId,
            snap.addedParticipantIds as never[],
          ),
        ),
      );
  }
  // Restore exact original source state
  await db
    .update(conversations)
    .set({
      status: snap.sourceBefore.status as never,
      resolvedAt: snap.sourceBefore.resolvedAt
        ? new Date(snap.sourceBefore.resolvedAt)
        : null,
      endReason: snap.sourceBefore.endReason ?? null,
      endNote: snap.sourceBefore.endNote ?? null,
      archivedAt: snap.sourceBefore.archivedAt
        ? new Date(snap.sourceBefore.archivedAt)
        : null,
      mergedIntoConversationId: null,
      mergedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, row.sourceId as never));

  await refreshConversationSummary(db, row.sourceId);
  await refreshConversationSummary(db, row.targetId);

  const [updated] = await db
    .update(supportMergeRecords)
    .set({
      undoneAt: new Date(),
      undoneByPrincipalId: actorPrincipalId as never,
    })
    .where(eq(supportMergeRecords.id, row.id))
    .returning({
      id: supportMergeRecords.id,
      entityKind: supportMergeRecords.entityKind,
      sourceId: supportMergeRecords.sourceId,
      targetId: supportMergeRecords.targetId,
      crossRequester: supportMergeRecords.crossRequester,
      crossCompany: supportMergeRecords.crossCompany,
      notifyRequester: supportMergeRecords.notifyRequester,
      mergedByPrincipalId: supportMergeRecords.mergedByPrincipalId,
      undoneAt: supportMergeRecords.undoneAt,
      undoneByPrincipalId: supportMergeRecords.undoneByPrincipalId,
      createdAt: supportMergeRecords.createdAt,
    });
  return updated!;
}

// --- Conversation Merge Routes ---

const previewConversationMerge = defineQuillsRoute({
  method: "post",
  path: "/conversations/merge/preview",
  operationId: "previewQuillsConversationMerge",
  summary:
    "Preview merging one or more conversations into a target conversation",
  action: "read",
  body: z.object({
    sourceConversationIds: z
      .array(flexibleToTypeIdSchema("conversation"))
      .min(1)
      .max(20),
    targetConversationId: flexibleToTypeIdSchema("conversation"),
  }),
  response: z.object({
    targetConversationId: z.string(),
    sourceCount: z.number(),
    messagesToMove: z.number(),
    attachmentsToMove: z.number(),
    crossRequester: z.boolean(),
    crossCompany: z.boolean(),
    requiresConfirmation: z.boolean(),
  }),
  responseDescription: "Impact preview of the conversation merge",
  errors: { 400: "Invalid merge targets", 404: "Conversation not found" },
  event: { none: "Read-only preview writes nothing" },
  handler: async ({ db, body }) => {
    const target = await findConversation(db, body.targetConversationId);
    const targetCo = await principalCompany(db, target.visitorPrincipalId);
    let crossRequester = false;
    let crossCompany = false;
    let messagesToMove = 0;
    let attachmentsToMove = 0;
    for (const srcId of Array.from(new Set(body.sourceConversationIds))) {
      if (srcId === body.targetConversationId) {
        throw new HTTPException(400, {
          message: "Cannot merge a conversation into itself",
        });
      }
      const src = await findConversation(db, srcId);
      if (src.visitorPrincipalId !== target.visitorPrincipalId) {
        crossRequester = true;
      }
      const srcCo = await principalCompany(db, src.visitorPrincipalId);
      if (srcCo && targetCo && srcCo !== targetCo) crossCompany = true;
      const msgs = await db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, src.id));
      messagesToMove += msgs.length;
      if (msgs.length) {
        const [countRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(files)
          .where(
            inArray(
              files.messageId,
              msgs.map((m) => m.id),
            ),
          );
        attachmentsToMove += countRow?.count ?? 0;
      }
    }
    return {
      targetConversationId: target.id,
      sourceCount: new Set(body.sourceConversationIds).size,
      messagesToMove,
      attachmentsToMove,
      crossRequester,
      crossCompany,
      requiresConfirmation: crossRequester || crossCompany,
    };
  },
});

const mergeConversations = defineQuillsRoute({
  method: "post",
  path: "/conversations/merge",
  operationId: "mergeQuillsConversations",
  summary:
    "Merge one or more conversations into a target conversation (reversible)",
  description:
    "Moves messages and attachments into targetConversationId silently by default. Cross-requester or cross-company merges require explicit confirmation flags (409 otherwise).",
  action: "update",
  body: z.object({
    sourceConversationIds: z
      .array(flexibleToTypeIdSchema("conversation"))
      .min(1)
      .max(20),
    targetConversationId: flexibleToTypeIdSchema("conversation"),
    confirmCrossRequester: z.boolean().default(false),
    confirmCrossCompany: z.boolean().default(false),
    notifyRequester: z.boolean().default(false),
  }),
  response: z.object({ merges: z.array(mergeRecordSchema) }),
  responseDescription: "Created reversible conversation merge records",
  errors: {
    400: "Cannot merge a conversation into itself",
    404: "Conversation not found",
    409: "Cross-requester/company confirmation required or already merged",
  },
  event: ({ body }, result) => ({
    type: "conversation.merged",
    entityType: "support_merge",
    entityId: result.merges[0]!.id,
    payload: {
      targetConversationId: body.targetConversationId,
      count: String(result.merges.length),
    },
  }),
  handler: async ({ db, actor, body }) => {
    const merges = [];
    for (const srcId of Array.from(new Set(body.sourceConversationIds))) {
      merges.push(
        await mergeOneConversation(
          db,
          actor.principalId,
          srcId,
          body.targetConversationId,
          {
            confirmCrossRequester: body.confirmCrossRequester,
            confirmCrossCompany: body.confirmCrossCompany,
            notifyRequester: body.notifyRequester,
          },
        ),
      );
    }
    return { merges };
  },
});

const undoConversationMerge = defineQuillsRoute({
  method: "post",
  path: "/conversations/merges/{mergeId}/undo",
  operationId: "undoQuillsConversationMerge",
  summary:
    "Undo a conversation merge and restore all messages, attachments, and state",
  action: "update",
  params: mergeParams,
  response: mergeRecordSchema,
  responseDescription: "The undone merge record",
  errors: { 404: "Merge record not found", 409: "Merge was already undone" },
  event: ({ params }, result) => ({
    type: "conversation.merge_undone",
    entityType: "support_merge",
    entityId: params.mergeId,
    payload: { sourceId: result.sourceId, targetId: result.targetId },
  }),
  handler: async ({ db, actor, params }) =>
    undoOneConversationMerge(db, actor.principalId, params.mergeId),
});

// --- Ticket Merge Routes ---

async function findTicket(db: Database, ticketId: string, lock = false) {
  const q = db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId as never), isNull(tickets.deletedAt)));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new HTTPException(404, { message: "Ticket not found" });
  return row;
}

const previewTicketMerge = defineQuillsRoute({
  method: "post",
  path: "/tickets/merge/preview",
  operationId: "previewQuillsTicketMerge",
  summary: "Preview merging one or more tickets into a target ticket",
  action: "read",
  body: z.object({
    sourceTicketIds: z.array(flexibleToTypeIdSchema("ticket")).min(1).max(20),
    targetTicketId: flexibleToTypeIdSchema("ticket"),
  }),
  response: z.object({
    targetTicketId: z.string(),
    sourceCount: z.number(),
    messagesToMove: z.number(),
    crossRequester: z.boolean(),
    crossCompany: z.boolean(),
    requiresConfirmation: z.boolean(),
  }),
  responseDescription: "Impact preview of the ticket merge",
  errors: { 400: "Invalid merge targets", 404: "Ticket not found" },
  event: { none: "Read-only preview writes nothing" },
  handler: async ({ db, body }) => {
    const target = await findTicket(db, body.targetTicketId);
    let crossRequester = false;
    let crossCompany = false;
    let messagesToMove = 0;
    for (const srcId of Array.from(new Set(body.sourceTicketIds))) {
      if (srcId === body.targetTicketId) {
        throw new HTTPException(400, {
          message: "Cannot merge a ticket into itself",
        });
      }
      const src = await findTicket(db, srcId);
      if (
        src.requesterPrincipalId &&
        target.requesterPrincipalId &&
        src.requesterPrincipalId !== target.requesterPrincipalId
      ) {
        crossRequester = true;
      }
      if (
        src.companyId &&
        target.companyId &&
        src.companyId !== target.companyId
      ) {
        crossCompany = true;
      }
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationMessages)
        .where(eq(conversationMessages.ticketId, src.id));
      messagesToMove += countRow?.count ?? 0;
    }
    return {
      targetTicketId: target.id,
      sourceCount: new Set(body.sourceTicketIds).size,
      messagesToMove,
      crossRequester,
      crossCompany,
      requiresConfirmation: crossRequester || crossCompany,
    };
  },
});

const mergeTickets = defineQuillsRoute({
  method: "post",
  path: "/tickets/merge",
  operationId: "mergeQuillsTickets",
  summary: "Merge one or more tickets into a target ticket (reversible)",
  description:
    "Moves ticket-scoped notes, merges linked customer conversations safely, copies watchers, closes source tickets as merged, and supports lossless undo.",
  action: "update",
  body: z.object({
    sourceTicketIds: z.array(flexibleToTypeIdSchema("ticket")).min(1).max(20),
    targetTicketId: flexibleToTypeIdSchema("ticket"),
    confirmCrossRequester: z.boolean().default(false),
    confirmCrossCompany: z.boolean().default(false),
    notifyRequester: z.boolean().default(false),
  }),
  response: z.object({ merges: z.array(mergeRecordSchema) }),
  responseDescription: "Created reversible ticket merge records",
  errors: {
    400: "Cannot merge a ticket into itself",
    404: "Ticket not found",
    409: "Cross-requester/company confirmation required or already merged",
  },
  event: ({ body }, result) => ({
    type: "ticket.merged",
    entityType: "support_merge",
    entityId: result.merges[0]!.id,
    payload: {
      targetTicketId: body.targetTicketId,
      count: String(result.merges.length),
    },
  }),
  handler: async ({ db, actor, body }) => {
    const target = await findTicket(db, body.targetTicketId, true);
    if (target.mergedIntoTicketId) {
      throw new HTTPException(409, {
        message: "Target ticket is already merged",
      });
    }
    // Find a closed status for marking merged source tickets
    const [closedStatus] = await db
      .select({ id: ticketStatuses.id })
      .from(ticketStatuses)
      .where(
        and(
          eq(ticketStatuses.category, "closed"),
          isNull(ticketStatuses.deletedAt),
        ),
      )
      .orderBy(asc(ticketStatuses.position))
      .limit(1);

    // Check target's linked customer conversation (1:1 partial unique index)
    const [targetLink] =
      target.type === "customer"
        ? await db
            .select({ conversationId: ticketConversations.conversationId })
            .from(ticketConversations)
            .where(
              and(
                eq(ticketConversations.ticketId, target.id),
                eq(ticketConversations.ticketType, "customer"),
              ),
            )
            .limit(1)
        : [];

    const merges = [];
    for (const srcId of Array.from(new Set(body.sourceTicketIds))) {
      if (srcId === target.id) {
        throw new HTTPException(400, {
          message: "Cannot merge a ticket into itself",
        });
      }
      const src = await findTicket(db, srcId, true);
      if (src.mergedIntoTicketId) {
        throw new HTTPException(409, {
          message: `Ticket ${src.id} is already merged`,
        });
      }
      const crossRequester =
        Boolean(src.requesterPrincipalId && target.requesterPrincipalId) &&
        src.requesterPrincipalId !== target.requesterPrincipalId;
      const srcCo =
        src.companyId ?? (await principalCompany(db, src.requesterPrincipalId));
      const targetCo =
        target.companyId ??
        (await principalCompany(db, target.requesterPrincipalId));
      const crossCompany = Boolean(srcCo && targetCo) && srcCo !== targetCo;
      if (crossRequester && !body.confirmCrossRequester) {
        throw new HTTPException(409, {
          message:
            "Tickets belong to different requesters; set confirmCrossRequester=true to confirm",
        });
      }
      if (crossCompany && !body.confirmCrossCompany) {
        throw new HTTPException(409, {
          message:
            "Tickets belong to different companies; set confirmCrossCompany=true to confirm",
        });
      }

      // Move ticket-scoped notes/messages to target ticket
      const movedMsgs = await db
        .update(conversationMessages)
        .set({ ticketId: target.id })
        .where(eq(conversationMessages.ticketId, src.id))
        .returning({ id: conversationMessages.id });

      // Copy watchers
      const srcWatchers = await db
        .select({ principalId: ticketSubscriptions.principalId })
        .from(ticketSubscriptions)
        .where(eq(ticketSubscriptions.ticketId, src.id));
      const targetWatchers = new Set(
        (
          await db
            .select({ principalId: ticketSubscriptions.principalId })
            .from(ticketSubscriptions)
            .where(eq(ticketSubscriptions.ticketId, target.id))
        ).map((r) => r.principalId),
      );
      const addedParticipantIds: string[] = [];
      for (const { principalId } of srcWatchers) {
        if (!targetWatchers.has(principalId)) {
          await db
            .insert(ticketSubscriptions)
            .values({ ticketId: target.id, principalId, reason: "manual" })
            .onConflictDoNothing();
          addedParticipantIds.push(principalId);
        }
      }

      // If BOTH source and target are customer tickets with linked customer conversations, merge them cleanly.
      let linkedConversationMergeId: string | null = null;
      const [srcLink] =
        src.type === "customer" && targetLink
          ? await db
              .select({ conversationId: ticketConversations.conversationId })
              .from(ticketConversations)
              .where(
                and(
                  eq(ticketConversations.ticketId, src.id),
                  eq(ticketConversations.ticketType, "customer"),
                ),
              )
              .limit(1)
          : [];
      if (
        srcLink &&
        targetLink &&
        srcLink.conversationId !== targetLink.conversationId
      ) {
        const [srcConvState] = await db
          .select({ mergedInto: conversations.mergedIntoConversationId })
          .from(conversations)
          .where(eq(conversations.id, srcLink.conversationId))
          .limit(1);
        if (!srcConvState?.mergedInto) {
          const convMerge = await mergeOneConversation(
            db,
            actor.principalId,
            srcLink.conversationId,
            targetLink.conversationId,
            {
              confirmCrossRequester: true,
              confirmCrossCompany: true,
              notifyRequester: body.notifyRequester,
            },
          );
          linkedConversationMergeId = convMerge.id;
        }
      }

      const [targetNotice] = await db
        .insert(conversationMessages)
        .values({
          ticketId: target.id,
          principalId: null,
          senderType: "system",
          isInternal: true,
          content: `Merged ticket #${src.number} (${src.id}) into this ticket.`,
        })
        .returning({ id: conversationMessages.id });

      const now = new Date();
      const snapshot: SupportMergeSnapshot = {
        movedMessageIds: movedMsgs.map((m) => m.id),
        addedParticipantIds,
        targetNoticeMessageId: targetNotice?.id ?? null,
        sourceBefore: {
          status: "active",
          statusId: src.statusId,
          resolvedAt: src.resolvedAt?.toISOString() ?? null,
        },
        linkedConversationMergeId,
      };

      await db
        .update(tickets)
        .set({
          ...(closedStatus && { statusId: closedStatus.id }),
          resolvedAt: now,
          mergedIntoTicketId: target.id,
          mergedAt: now,
          updatedAt: now,
        })
        .where(eq(tickets.id, src.id));

      const [record] = await db
        .insert(supportMergeRecords)
        .values({
          entityKind: "ticket",
          sourceId: src.id,
          targetId: target.id,
          crossRequester,
          crossCompany,
          notifyRequester: body.notifyRequester,
          mergedByPrincipalId: actor.principalId as never,
          snapshot,
        })
        .returning({
          id: supportMergeRecords.id,
          entityKind: supportMergeRecords.entityKind,
          sourceId: supportMergeRecords.sourceId,
          targetId: supportMergeRecords.targetId,
          crossRequester: supportMergeRecords.crossRequester,
          crossCompany: supportMergeRecords.crossCompany,
          notifyRequester: supportMergeRecords.notifyRequester,
          mergedByPrincipalId: supportMergeRecords.mergedByPrincipalId,
          undoneAt: supportMergeRecords.undoneAt,
          undoneByPrincipalId: supportMergeRecords.undoneByPrincipalId,
          createdAt: supportMergeRecords.createdAt,
        });
      merges.push(record!);
    }

    return { merges };
  },
});

const undoTicketMerge = defineQuillsRoute({
  method: "post",
  path: "/tickets/merges/{mergeId}/undo",
  operationId: "undoQuillsTicketMerge",
  summary:
    "Undo a ticket merge and restore messages, linked conversation, and state",
  action: "update",
  params: mergeParams,
  response: mergeRecordSchema,
  responseDescription: "The undone ticket merge record",
  errors: { 404: "Merge record not found", 409: "Merge was already undone" },
  event: ({ params }, result) => ({
    type: "ticket.merge_undone",
    entityType: "support_merge",
    entityId: params.mergeId,
    payload: { sourceId: result.sourceId, targetId: result.targetId },
  }),
  handler: async ({ db, actor, params }) => {
    const [row] = await db
      .select()
      .from(supportMergeRecords)
      .where(
        and(
          eq(supportMergeRecords.id, params.mergeId),
          eq(supportMergeRecords.entityKind, "ticket"),
        ),
      )
      .for("update");
    if (!row)
      throw new HTTPException(404, { message: "Merge record not found" });
    if (row.undoneAt) {
      throw new HTTPException(409, { message: "Merge was already undone" });
    }
    const lockedIds = [row.sourceId, row.targetId].sort();
    const lockedTickets = await db
      .select({ id: tickets.id, mergedInto: tickets.mergedIntoTicketId })
      .from(tickets)
      .where(inArray(tickets.id, lockedIds as never[]))
      .orderBy(tickets.id)
      .for("update");
    const targetTicket = lockedTickets.find((t) => t.id === row.targetId);
    const sourceTicket = lockedTickets.find((t) => t.id === row.sourceId);
    if (targetTicket?.mergedInto) {
      throw new HTTPException(409, {
        message: "Undo the later merge on the target ticket first",
      });
    }
    if (
      sourceTicket &&
      sourceTicket.mergedInto &&
      sourceTicket.mergedInto !== row.targetId
    ) {
      throw new HTTPException(409, {
        message: "Source ticket is now merged into a different target",
      });
    }
    const snap = row.snapshot;
    if (snap.movedMessageIds.length) {
      await db
        .update(conversationMessages)
        .set({ ticketId: row.sourceId as never })
        .where(
          and(
            eq(conversationMessages.ticketId, row.targetId as never),
            inArray(conversationMessages.id, snap.movedMessageIds as never[]),
          ),
        );
    }
    if (snap.targetNoticeMessageId) {
      await db
        .delete(conversationMessages)
        .where(
          eq(conversationMessages.id, snap.targetNoticeMessageId as never),
        );
    }
    if (snap.addedParticipantIds?.length) {
      await db
        .delete(ticketSubscriptions)
        .where(
          and(
            eq(ticketSubscriptions.ticketId, row.targetId as never),
            inArray(
              ticketSubscriptions.principalId,
              snap.addedParticipantIds as never[],
            ),
          ),
        );
    }
    if (snap.linkedConversationMergeId) {
      const [linkedMerge] = await db
        .select({ undoneAt: supportMergeRecords.undoneAt })
        .from(supportMergeRecords)
        .where(eq(supportMergeRecords.id, snap.linkedConversationMergeId))
        .limit(1);
      if (linkedMerge && !linkedMerge.undoneAt) {
        await undoOneConversationMerge(
          db,
          actor.principalId,
          snap.linkedConversationMergeId,
        );
      }
    }
    await db
      .update(tickets)
      .set({
        ...(snap.sourceBefore.statusId && {
          statusId: snap.sourceBefore.statusId as never,
        }),
        resolvedAt: snap.sourceBefore.resolvedAt
          ? new Date(snap.sourceBefore.resolvedAt)
          : null,
        mergedIntoTicketId: null,
        mergedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, row.sourceId as never));

    const [updated] = await db
      .update(supportMergeRecords)
      .set({
        undoneAt: new Date(),
        undoneByPrincipalId: actor.principalId as never,
      })
      .where(eq(supportMergeRecords.id, row.id))
      .returning({
        id: supportMergeRecords.id,
        entityKind: supportMergeRecords.entityKind,
        sourceId: supportMergeRecords.sourceId,
        targetId: supportMergeRecords.targetId,
        crossRequester: supportMergeRecords.crossRequester,
        crossCompany: supportMergeRecords.crossCompany,
        notifyRequester: supportMergeRecords.notifyRequester,
        mergedByPrincipalId: supportMergeRecords.mergedByPrincipalId,
        undoneAt: supportMergeRecords.undoneAt,
        undoneByPrincipalId: supportMergeRecords.undoneByPrincipalId,
        createdAt: supportMergeRecords.createdAt,
      });
    return updated!;
  },
});

export const conversationMergeRouter = apiRouter<
  BaseVariables & { workspaceId: string }
>()
  .openapi(...previewConversationMerge)
  .openapi(...mergeConversations)
  .openapi(...undoConversationMerge);

export const ticketMergeRouter = apiRouter<
  BaseVariables & { workspaceId: string }
>()
  .openapi(...previewTicketMerge)
  .openapi(...mergeTickets)
  .openapi(...undoTicketMerge);
