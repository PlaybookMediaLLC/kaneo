// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { nullableResponseTimestamp, responseTimestamp, z } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { conversationSummaries } from "../../database/quills/schema/conversation-summary";
import type { Database } from "../framework/define-route";
import { realEmail } from "../directory/customer";

// Shared shapes and reads for the teammate conversation routes.

export type ConversationId = TypeId<"conversation">;
export type PrincipalId = TypeId<"principal">;

export const conversationParams = z.object({
  conversationId: flexibleToTypeIdSchema("conversation"),
});
export const messageParams = z.object({
  messageId: flexibleToTypeIdSchema("conversation_msg"),
});
export const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });
export const conflict = (message: string) =>
  new HTTPException(409, { message });
export const errors = {
  404: "Conversation or related record not found",
  409: "The conversation is not in the required state",
};

export const statuses = conversations.status.enumValues;
export const priorities = conversations.priority.enumValues;
export const endReasons = [
  "resolved",
  "tracked_as_feedback",
  "duplicate",
  "no_response",
  "spam",
  "other",
] as const;
export const messageText = z.string().trim().min(1).max(10000);

const tagRef = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export const conversationItem = z.object({
  id: z.string(),
  status: z.enum(statuses),
  priority: z.enum(priorities),
  channel: z.string(),
  source: z.string(),
  subject: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: responseTimestamp,
  createdAt: responseTimestamp,
  updatedAt: nullableResponseTimestamp,
  visitorPrincipalId: z.string(),
  visitorName: z.string().nullable(),
  visitorEmail: z.string().nullable(),
  isTest: z.boolean(),
  assignedAgentPrincipalId: z.string().nullable(),
  assignedTeamId: z.string().nullable(),
  unreadCount: z.number(),
  waitingSince: nullableResponseTimestamp,
  snoozedUntil: nullableResponseTimestamp,
  resolvedAt: nullableResponseTimestamp,
  endReason: z.string().nullable(),
  endNote: z.string().nullable(),
  spamReason: z.string().nullable(),
  csatRating: z.number().nullable(),
  agentLastReadAt: nullableResponseTimestamp,
  visitorLastReadAt: nullableResponseTimestamp,
  tags: z.array(tagRef),
});

export const attributeValue = z
  .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
  .nullable();
export const attributeEntry = z.object({
  key: z.string(),
  value: attributeValue,
  source: z.string().nullable(),
  at: z.string().nullable(),
});
export const conversationDetail = conversationItem.extend({
  attributes: z.array(attributeEntry),
  translation: z.object({
    enabled: z.boolean(),
    detectedLanguage: z.string().nullable(),
    dismissedAt: nullableResponseTimestamp,
  }),
  summary: z.string().nullable(),
  csatComment: z.string().nullable(),
});
export const changedConversation = conversationDetail.extend({
  changed: z.boolean(),
});

const columns = {
  id: conversations.id,
  status: conversations.status,
  priority: conversations.priority,
  channel: conversations.channel,
  source: conversations.source,
  subject: conversations.subject,
  lastMessagePreview: conversations.lastMessagePreview,
  lastMessageAt: conversations.lastMessageAt,
  createdAt: conversations.createdAt,
  updatedAt: conversations.updatedAt,
  visitorPrincipalId: conversations.visitorPrincipalId,
  visitorName: sql<
    string | null
  >`coalesce(${user.name}, ${principal.displayName})`,
  visitorEmail: conversations.visitorEmail,
  contactEmail: principal.contactEmail,
  accountEmail: user.email,
  isTest: sql<boolean>`(${principal.testOwnerPrincipalId} is not null)`,
  assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
  assignedTeamId: conversations.assignedTeamId,
  waitingSince: conversations.waitingSince,
  snoozedUntil: conversations.snoozedUntil,
  resolvedAt: conversations.resolvedAt,
  endReason: conversations.endReason,
  endNote: conversations.endNote,
  spamReason: conversations.spamReason,
  csatRating: conversations.csatRating,
  agentLastReadAt: conversations.agentLastReadAt,
  visitorLastReadAt: conversations.visitorLastReadAt,
};

/** Conversations joined to their visitor. The caller adds order and limit. */
export const selectConversations = (db: Database, where: SQL | undefined) =>
  db
    .select(columns)
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(where)
    .$dynamic();

/** Lists and counts leave out a teammate's test conversations (the visitor is a test customer). */
export const realConversation = isNull(principal.testOwnerPrincipalId);
/** The same rule as a probe, for queries that do not join the visitor. */
export const notTestConversation = sql`not exists (select 1 from ${principal} test_visitor where test_visitor.id = ${conversations.visitorPrincipalId} and test_visitor.test_owner_principal_id is not null)`;

type Row = Awaited<
  ReturnType<ReturnType<typeof selectConversations>["execute"]>
>[number];

/** Adds unread counts and live tags, with one query each for the page. */
export async function toItems(db: Database, rows: Row[]) {
  const ids = rows.map((row) => row.id);
  const unread = ids.length
    ? await db
        .select({ id: conversationMessages.conversationId, n: count() })
        .from(conversationMessages)
        .innerJoin(
          conversations,
          eq(conversations.id, conversationMessages.conversationId),
        )
        .where(
          and(
            inArray(conversationMessages.conversationId, ids),
            eq(conversationMessages.senderType, "visitor"),
            eq(conversationMessages.isInternal, false),
            isNull(conversationMessages.deletedAt),
            or(
              isNull(conversations.agentLastReadAt),
              gt(conversationMessages.createdAt, conversations.agentLastReadAt),
            ),
          ),
        )
        .groupBy(conversationMessages.conversationId)
    : [];
  const tags = ids.length
    ? await db
        .select({
          conversationId: conversationTagAssignments.conversationId,
          id: conversationTags.id,
          name: conversationTags.name,
          color: conversationTags.color,
        })
        .from(conversationTagAssignments)
        .innerJoin(
          conversationTags,
          eq(conversationTags.id, conversationTagAssignments.conversationTagId),
        )
        .where(
          and(
            inArray(conversationTagAssignments.conversationId, ids),
            isNull(conversationTags.deletedAt),
          ),
        )
        .orderBy(asc(conversationTags.name))
    : [];
  const counts = new Map(unread.map((row) => [row.id, row.n]));
  return rows.map(({ contactEmail, accountEmail, visitorEmail, ...row }) => ({
    ...row,
    visitorEmail:
      realEmail(visitorEmail) ??
      realEmail(contactEmail) ??
      realEmail(accountEmail),
    unreadCount: counts.get(row.id) ?? 0,
    tags: tags
      .filter((tag) => tag.conversationId === row.id)
      .map(({ conversationId: _, ...tag }) => tag),
  }));
}

/** A conversation of this workspace, or 404. `lock` holds the row for a read-modify-write. */
export async function findConversation(
  db: Database,
  id: ConversationId,
  lock = false,
) {
  const query = db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("Conversation");
  return row;
}
export type Conversation = Awaited<ReturnType<typeof findConversation>>;

/** Unwraps `{ v, src, at }` envelopes; skips values that are not attribute values. */
export function attributeEntries(values: Record<string, unknown>) {
  return Object.entries(values).flatMap(([key, raw]) => {
    const envelope =
      raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      "v" in raw &&
      typeof (raw as { src?: unknown }).src === "string"
        ? (raw as { v: unknown; src: string; at?: unknown })
        : undefined;
    const value = attributeValue.safeParse(envelope ? envelope.v : raw);
    return value.success
      ? [
          {
            key,
            value: value.data,
            source: envelope?.src ?? null,
            at: typeof envelope?.at === "string" ? envelope.at : null,
          },
        ]
      : [];
  });
}

/** One conversation with its tags, attributes, summary and translation state. 404 when missing. */
export async function loadConversation(db: Database, id: ConversationId) {
  const [row] = await selectConversations(db, eq(conversations.id, id)).limit(
    1,
  );
  if (!row) throw notFound("Conversation");
  const [item] = await toItems(db, [row]);
  const [extra] = await db
    .select({
      customAttributes: conversations.customAttributes,
      translationEnabled: conversations.translationEnabled,
      detectedLanguage: conversations.detectedCustomerLanguage,
      dismissedAt: conversations.translationDismissedAt,
      csatComment: conversations.csatComment,
      summary: conversationSummaries.summary,
    })
    .from(conversations)
    .leftJoin(
      conversationSummaries,
      eq(conversationSummaries.conversationId, conversations.id),
    )
    .where(eq(conversations.id, id));
  return {
    ...item!,
    attributes: attributeEntries(extra!.customAttributes),
    translation: {
      enabled: extra!.translationEnabled,
      detectedLanguage: extra!.detectedLanguage,
      dismissedAt: extra!.dismissedAt,
    },
    summary: extra!.summary,
    csatComment: extra!.csatComment,
  };
}

type Metadata = NonNullable<
  (typeof conversationMessages.$inferInsert)["metadata"]
>;
export type SystemEvent = NonNullable<Metadata["systemEvent"]>;

/** An author-less transcript notice. `internal` keeps it on the team side only. */
export async function systemNotice(
  db: Database,
  conversationId: ConversationId,
  content: string,
  options: { internal?: boolean; event?: SystemEvent } = {},
) {
  await db.insert(conversationMessages).values({
    conversationId,
    principalId: null,
    senderType: "system",
    content,
    isInternal: options.internal ?? false,
    metadata: options.event ? { systemEvent: options.event } : null,
  });
}

/** A display name for transcript notices. */
export async function principalName(db: Database, id: PrincipalId) {
  const [row] = await db
    .select({ name: principal.displayName })
    .from(principal)
    .where(eq(principal.id, id));
  return row?.name ?? "A teammate";
}

/** The teammate principals of current workspace members among `ids`. */
export async function currentTeammates(
  db: Database,
  members: readonly string[],
  ids: readonly PrincipalId[],
) {
  if (!ids.length || !members.length) return [];
  return db
    .select({ id: principal.id, name: principal.displayName })
    .from(principal)
    .where(
      and(
        inArray(principal.id, [...ids]),
        isNotNull(principal.kaneoUserId),
        inArray(principal.kaneoUserId, [...members]),
      ),
    );
}

/** The plain-text list preview the inbox shows. */
export const preview = (content: string) =>
  content.length > 140 ? `${content.slice(0, 139)}…` : content;
