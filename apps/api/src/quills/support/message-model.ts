// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { nullableResponseTimestamp, responseTimestamp, z } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import {
  conversationMessageFlags,
  conversationMessageReactions,
  conversationMessages,
} from "../../database/quills/schema/conversation";
import type { Database, QuillsActor } from "../framework/define-route";
import { conflict, notFound } from "./conversation-model";

// Message shapes for teammates. Reactions, flags and internal notes are team-only:
// a later customer route must not reuse this projection.

export type MessageId = TypeId<"conversation_msg">;
export const reactionEmojis = ["👍", "❤️", "🎉", "😄", "🤔", "👀"] as const;

const reactions = z.array(
  z.object({ emoji: z.string(), count: z.number(), reacted: z.boolean() }),
);
export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderType: z.enum(conversationMessages.senderType.enumValues),
  /** Team-only: an internal note or a team-only notice. */
  isInternal: z.boolean(),
  authorPrincipalId: z.string().nullable(),
  authorName: z.string().nullable(),
  content: z.string(),
  systemKind: z.string().nullable(),
  embeds: z.array(z.object({ kind: z.string(), id: z.string() })),
  attachments: z.array(
    z.object({
      fileId: z.string().nullable(),
      name: z.string(),
      contentType: z.string(),
      size: z.number(),
    }),
  ),
  reactions,
  flaggedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
  editedAt: nullableResponseTimestamp,
});
export const reactionsSchema = reactions;

/** Messages joined to their author. The caller adds order and limit. */
export const selectMessages = (db: Database, where: SQL | undefined) =>
  db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      senderType: conversationMessages.senderType,
      isInternal: conversationMessages.isInternal,
      authorPrincipalId: conversationMessages.principalId,
      authorName: sql<
        string | null
      >`coalesce(${user.name}, ${principal.displayName})`,
      content: conversationMessages.content,
      contentJson: conversationMessages.contentJson,
      metadata: conversationMessages.metadata,
      attachments: conversationMessages.attachments,
      createdAt: conversationMessages.createdAt,
      editedAt: conversationMessages.editedAt,
    })
    .from(conversationMessages)
    .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(where)
    .$dynamic();

type Row = Awaited<
  ReturnType<ReturnType<typeof selectMessages>["execute"]>
>[number];

/** Reaction counts per message, with the caller's own marked. */
export async function reactionsFor(
  db: Database,
  actor: QuillsActor,
  ids: MessageId[],
) {
  if (!ids.length) return new Map<string, z.infer<typeof reactions>>();
  const rows = await db
    .select({
      messageId: conversationMessageReactions.conversationMessageId,
      emoji: conversationMessageReactions.emoji,
      count: count(),
      reacted: sql<boolean>`bool_or(${conversationMessageReactions.principalId} = ${sql.param(actor.principalId, conversationMessageReactions.principalId)})`,
    })
    .from(conversationMessageReactions)
    .where(inArray(conversationMessageReactions.conversationMessageId, ids))
    .groupBy(
      conversationMessageReactions.conversationMessageId,
      conversationMessageReactions.emoji,
    )
    .orderBy(conversationMessageReactions.emoji);
  const map = new Map<string, z.infer<typeof reactions>>();
  for (const { messageId, ...reaction } of rows)
    map.set(messageId, [...(map.get(messageId) ?? []), reaction]);
  return map;
}

/** Top-level embed nodes of a rich message, for example a shared post. */
export const embedsOf = (json: Row["contentJson"]) =>
  (json?.content ?? []).flatMap((node) =>
    node.type === "quackbackEmbed" &&
    typeof node.attrs?.kind === "string" &&
    typeof node.attrs?.id === "string"
      ? [{ kind: node.attrs.kind, id: node.attrs.id }]
      : [],
  );

/** Adds reactions and the caller's flag, with one query each. */
export async function toMessages(
  db: Database,
  actor: QuillsActor,
  rows: Row[],
) {
  const ids = rows.map((row) => row.id);
  const reactionMap = await reactionsFor(db, actor, ids);
  const flags = ids.length
    ? await db
        .select({
          id: conversationMessageFlags.conversationMessageId,
          flaggedAt: conversationMessageFlags.flaggedAt,
        })
        .from(conversationMessageFlags)
        .where(
          and(
            inArray(conversationMessageFlags.conversationMessageId, ids),
            eq(conversationMessageFlags.principalId, actor.principalId),
          ),
        )
    : [];
  const flagMap = new Map(flags.map((flag) => [flag.id, flag.flaggedAt]));
  return rows.map(({ contentJson, metadata, attachments, ...row }) => ({
    ...row,
    conversationId: row.conversationId!,
    systemKind: metadata?.systemEvent?.kind ?? null,
    embeds: embedsOf(contentJson),
    attachments: (attachments ?? []).map((file) => ({
      fileId: file.fileId ?? null,
      name: file.name,
      contentType: file.contentType,
      size: file.size,
    })),
    reactions: reactionMap.get(row.id) ?? [],
    flaggedAt: flagMap.get(row.id) ?? null,
  }));
}

export async function loadMessage(
  db: Database,
  actor: QuillsActor,
  id: MessageId,
) {
  const [row] = await selectMessages(db, eq(conversationMessages.id, id));
  if (!row) throw notFound("Message");
  return (await toMessages(db, actor, [row]))[0]!;
}

/** A live message of a conversation (ticket threads belong to the tickets routes). 404 otherwise. */
export async function findMessage(db: Database, id: MessageId) {
  const [message] = await db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      principalId: conversationMessages.principalId,
      senderType: conversationMessages.senderType,
      isInternal: conversationMessages.isInternal,
      createdAt: conversationMessages.createdAt,
      metadata: conversationMessages.metadata,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, id),
        isNotNull(conversationMessages.conversationId),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .limit(1);
  if (!message) throw notFound("Message");
  return { ...message, conversationId: message.conversationId! };
}

/** Reactions and flags are for content: a system notice is refused. */
export async function findContentMessage(db: Database, id: MessageId) {
  const message = await findMessage(db, id);
  if (message.senderType === "system")
    throw conflict("System notices cannot be changed");
  return message;
}
