// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
// The customer side of support, shared by audience: "portal" and audience: "widget" routes.
// A customer reads only conversations whose visitor is the caller's own principal. Internal notes,
// team-only notices, deleted rows, assignees, tags and teammate principal IDs never reach a customer.
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { typeIdSchema } from "@kaneo/ids/zod";
import {
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../../../openapi";
import {
  principal,
  settings,
  user,
} from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { kvStore } from "../../../database/quills/schema/kv";
import { hashToken, type QuillsCaller } from "../../framework/audience";
import type { Database } from "../../framework/define-route";
import { requirePortalAccess } from "../../portal/gate";
import { parseJson, record } from "../../settings/area";
import { readConfig } from "../../settings/widget";
import {
  conflict,
  notFound,
  preview,
  type ConversationId,
  type PrincipalId,
} from "../conversation-model";
import { embedsOf, type MessageId } from "../message-model";

export {
  conflict,
  conversationParams,
  messageText,
  notFound,
  preview,
  type ConversationId,
  type PrincipalId,
} from "../conversation-model";
export type { MessageId } from "../message-model";
export type Customer = "portal" | "widget";

/**
 * 404 unless the support surface is on for this audience. Widget: the widget's own tab switch
 * (the session already proved the widget is on). Portal: the portal switch, its private gate
 * (403) and the portal's support switch (settings/portal.ts, on by default).
 */
export async function requireSurface(
  db: Database,
  audience: Customer,
  caller: QuillsCaller,
  surface: "messenger" | "tickets",
) {
  const [row] = await db.select().from(settings).limit(1);
  if (audience === "portal") {
    await requirePortalAccess(db, caller);
    if (record(parseJson(row?.portalConfig ?? null).support).enabled === false)
      throw notFound("Support");
    return;
  }
  const config = row && readConfig(row);
  if (!config?.enabled || !config.tabs[surface])
    throw notFound(surface === "messenger" ? "Messenger" : "Tickets");
}

/** Messages a customer may read: not internal, not deleted, not a retired Home transcript. */
export const customerVisible: SQL = and(
  eq(conversationMessages.isInternal, false),
  isNull(conversationMessages.deletedAt),
  isNull(conversationMessages.workspaceThreadKey),
)!;

/** The RFC 0002 key: a client-made opaque value, reused only for a retry of the same text. */
export const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, _ and - only");

export const customerMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  /** True for the caller's own messages. */
  fromVisitor: z.boolean(),
  senderType: z.enum(conversationMessages.senderType.enumValues),
  /** A teammate's display name and avatar; never a principal ID or an email. Null for notices. */
  author: z
    .object({ name: z.string().nullable(), avatarUrl: z.string().nullable() })
    .nullable(),
  content: z.string(),
  /** Records a teammate shared into the thread, for example a post (the text may be empty). */
  embeds: z.array(z.object({ kind: z.string(), id: z.string() })),
  attachments: z.array(
    z.object({ name: z.string(), contentType: z.string(), size: z.number() }),
  ),
  createdAt: responseTimestamp,
  editedAt: nullableResponseTimestamp,
});

export const customerConversationSchema = z.object({
  id: z.string(),
  status: z.enum(conversations.status.enumValues),
  /** A closed conversation is read-only in the source; a new message still reopens it here. */
  isReadOnly: z.boolean(),
  subject: z.string().nullable(),
  preview: z.string().nullable(),
  lastMessageAt: responseTimestamp,
  createdAt: responseTimestamp,
  unreadCount: z.number(),
  csatRating: z.number().nullable(),
  csatSubmittedAt: nullableResponseTimestamp,
});

/** The caller's own conversation, or 404. A foreign or another customer's ID looks missing. */
export async function ownConversation(
  db: Database,
  me: PrincipalId | null,
  id: ConversationId,
  lock = false,
) {
  if (!me) throw notFound("Conversation");
  const query = db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, id), eq(conversations.visitorPrincipalId, me)),
    )
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("Conversation");
  return row;
}
type ConversationRow = Awaited<ReturnType<typeof ownConversation>>;

/** Team messages after the caller's read watermark, per conversation; `ids` limits the conversations. */
async function unreadByConversation(
  db: Database,
  me: PrincipalId,
  ids?: ConversationId[],
) {
  const rows = await db
    .select({ id: conversationMessages.conversationId, n: count() })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessages.conversationId),
    )
    .where(
      and(
        eq(conversations.visitorPrincipalId, me),
        ids ? inArray(conversations.id, ids) : undefined,
        eq(conversationMessages.senderType, "agent"),
        customerVisible,
        sql`${conversationMessages.createdAt} > coalesce(${conversations.visitorLastReadAt}, '-infinity'::timestamptz)`,
      ),
    )
    .groupBy(conversationMessages.conversationId);
  return new Map(rows.map((row) => [row.id!, row.n]));
}

export async function unreadTotal(db: Database, me: PrincipalId | null) {
  if (!me) return 0;
  let total = 0;
  for (const n of (await unreadByConversation(db, me)).values()) total += n;
  return total;
}

export async function toConversations(
  db: Database,
  me: PrincipalId,
  rows: ConversationRow[],
) {
  const unread = rows.length
    ? await unreadByConversation(
        db,
        me,
        rows.map((row) => row.id),
      )
    : new Map<string, number>();
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    isReadOnly: row.status === "closed",
    subject: row.subject,
    preview: row.lastMessagePreview,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    unreadCount: unread.get(row.id) ?? 0,
    csatRating: row.csatRating,
    csatSubmittedAt: row.csatSubmittedAt,
  }));
}

/** Customer-visible messages joined to their author. The caller adds order and limit. */
export const selectCustomerMessages = (
  db: Database,
  me: PrincipalId,
  where: SQL | undefined,
) =>
  db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      senderType: conversationMessages.senderType,
      fromVisitor: sql<boolean>`(${conversationMessages.principalId} is not distinct from ${sql.param(me, conversationMessages.principalId)} and ${conversationMessages.senderType} = 'visitor')`,
      authorName: sql<
        string | null
      >`coalesce(${user.name}, ${principal.displayName})`,
      authorAvatarUrl: principal.avatarUrl,
      content: conversationMessages.content,
      contentJson: conversationMessages.contentJson,
      attachments: conversationMessages.attachments,
      createdAt: conversationMessages.createdAt,
      editedAt: conversationMessages.editedAt,
    })
    .from(conversationMessages)
    .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(and(customerVisible, where))
    .$dynamic();

type MessageRow = Awaited<
  ReturnType<ReturnType<typeof selectCustomerMessages>["execute"]>
>[number];

export const toMessages = (rows: MessageRow[]) =>
  rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId!,
    fromVisitor: row.fromVisitor,
    senderType: row.senderType,
    author:
      row.senderType === "system"
        ? null
        : { name: row.authorName, avatarUrl: row.authorAvatarUrl },
    content: row.content,
    embeds: embedsOf(row.contentJson),
    attachments: (row.attachments ?? []).map((file) => ({
      name: file.name,
      contentType: file.contentType,
      size: file.size,
    })),
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  }));

/** A customer-visible message of this conversation (deleted included, for cursors), or 404. */
export async function cursorMessage(
  db: Database,
  conversationId: ConversationId,
  id: MessageId,
) {
  const [row] = await db
    .select({
      id: conversationMessages.id,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, id),
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.isInternal, false),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Message");
  return row;
}

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const receiptValue = z.object({
  hash: z.string(),
  conversationId: typeIdSchema("conversation"),
  messageId: typeIdSchema("conversation_msg"),
});

/**
 * Claims an idempotency receipt (RFC 0002) in the request transaction, so it rolls back with the
 * write. `{ claimed: true }`: write the message with the given IDs. Otherwise the stored result of
 * the first request with this key; a different text or an expired key is 409. A concurrent
 * duplicate waits on the primary key until the first request commits or rolls back.
 */
export async function claimReceipt(
  db: Database,
  me: PrincipalId,
  scope: string,
  key: string,
  content: string,
  ids: { conversationId: ConversationId; messageId: MessageId },
) {
  const hash = hashToken(content);
  const name = `support:receipt:${me}:${scope}:${key}`;
  const [claimed] = await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key: name,
      value: { hash, ...ids },
      expiresAt: new Date(Date.now() + RECEIPT_TTL_MS),
    })
    .onConflictDoNothing()
    .returning({ key: kvStore.key });
  if (claimed) return { claimed: true as const, ...ids };
  const [stored] = await db
    .select({ value: kvStore.value, expiresAt: kvStore.expiresAt })
    .from(kvStore)
    .where(and(eq(kvStore.workspaceKey, "_"), eq(kvStore.key, name)))
    .limit(1);
  const value = receiptValue.safeParse(stored?.value);
  // ponytail: a receipt the kv sweeper already removed is a new write; keep tombstones if that matters.
  if (!stored || !value.success || stored.expiresAt <= new Date())
    throw conflict("This idempotency key has expired; send with a new key");
  if (value.data.hash !== hash)
    throw conflict("This idempotency key was used for a different message");
  return {
    claimed: false as const,
    conversationId: value.data.conversationId,
    messageId: value.data.messageId,
  };
}

/** Writes the visitor's message and moves the conversation to the visitor's side. */
export async function insertVisitorMessage(
  db: Database,
  me: PrincipalId,
  conversation: ConversationRow,
  messageId: MessageId,
  content: string,
) {
  await db.insert(conversationMessages).values({
    id: messageId,
    conversationId: conversation.id,
    principalId: me,
    senderType: "visitor",
    content,
  });
  // The stored microsecond time: a millisecond JS Date would sort before the message itself.
  const at = sql`(select ${conversationMessages.createdAt} from ${conversationMessages} where ${eq(conversationMessages.id, messageId)})`;
  // A reply reopens a closed or snoozed conversation, except one ended as spam.
  const reopen =
    conversation.status !== "open" && conversation.endReason !== "spam";
  await db
    .update(conversations)
    .set({
      lastMessageAt: at,
      lastMessagePreview: preview(content),
      visitorLastReadAt: at,
      waitingSince: sql`coalesce(${conversations.waitingSince}, ${at})`,
      updatedAt: at,
      ...(reopen && {
        status: "open" as const,
        snoozedUntil: null,
        resolvedAt: null,
        endReason: null,
        endNote: null,
        spamReason: null,
      }),
    })
    .where(eq(conversations.id, conversation.id));
}

/**
 * Records a rating as the source does: the first score and its time stay, a later call may add the
 * comment. `changed` is false for a repeat that adds nothing.
 */
export async function recordCsat(
  db: Database,
  conversation: ConversationRow,
  rating: number,
  comment: string | undefined,
) {
  const text = comment?.trim() ? comment.trim().slice(0, 2000) : undefined;
  const firstRating = conversation.csatRating === null;
  const firstComment = text !== undefined && conversation.csatComment === null;
  if (firstRating || firstComment)
    await db
      .update(conversations)
      .set({
        csatRating: conversation.csatRating ?? rating,
        csatSubmittedAt: conversation.csatSubmittedAt ?? new Date(),
        ...(firstComment && { csatComment: text }),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id));
  return {
    changed: firstRating || firstComment,
    rating: conversation.csatRating ?? rating,
  };
}

/** One kv row per conversation side: a newer signal replaces the older one. */
export const typingKey = (
  conversationId: ConversationId,
  side: "visitor" | "agent",
) => `support:typing:${conversationId}:${side}`;
const TYPING_TTL_SECONDS = 8;

export async function signalTyping(
  db: Database,
  conversationId: ConversationId,
  side: "visitor" | "agent",
) {
  await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key: typingKey(conversationId, side),
      value: {},
      expiresAt: sql`now() + make_interval(secs => ${TYPING_TTL_SECONDS})`,
    })
    .onConflictDoUpdate({
      target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
      set: {
        expiresAt: sql`now() + make_interval(secs => ${TYPING_TTL_SECONDS})`,
      },
    });
}

export async function isTyping(
  db: Database,
  conversationId: ConversationId,
  side: "visitor" | "agent",
) {
  const [row] = await db
    .select({ key: kvStore.key })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, typingKey(conversationId, side)),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return Boolean(row);
}
