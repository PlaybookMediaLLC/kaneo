// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { pagingNumber, z } from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import {
  conversationMessageMentions,
  conversationMessages,
  conversations,
  conversationTagAssignments,
} from "../../database/quills/schema/conversation";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  findConversation,
  priorities,
  realConversation,
  selectConversations,
  statuses,
  toItems,
} from "./conversation-model";

// The teammate inbox list: filters, five sorts and a keyset cursor re-read from the database.

export const listFilters = z.object({
  status: z.enum(statuses).optional(),
  priority: z.enum(priorities).optional(),
  assignee: z
    .union([
      z.enum(["mine", "unassigned"]),
      flexibleToTypeIdSchema("principal"),
    ])
    .optional(),
  teamId: flexibleToTypeIdSchema("team").optional(),
  visitorPrincipalId: flexibleToTypeIdSchema("principal").optional(),
  tagId: flexibleToTypeIdSchema("conversation_tag").optional(),
  channel: z.enum(conversations.channel.enumValues).optional(),
  source: z.string().trim().min(1).max(32).optional(),
  waitingOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  view: z.enum(["all", "mentions", "spam", "created_by_me"]).default("all"),
  search: z.string().trim().max(200).optional(),
  sort: z
    .enum(["recent", "oldest", "created", "waiting", "priority"])
    .default("recent"),
  cursor: flexibleToTypeIdSchema("conversation").optional(),
  limit: pagingNumber(1, 100, 25),
});
export type ListFilters = z.output<typeof listFilters>;

const rank = sql`(case ${conversations.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end)`;
// ponytail: the coalesce keeps "nobody waiting" last without a NULLS LAST keyset; it skips the waiting index.
const waiting = sql`coalesce(${conversations.waitingSince}, 'infinity'::timestamptz)`;
const sorts: Record<
  ListFilters["sort"],
  { keys: (AnyColumn | SQL)[]; ascending: boolean }
> = {
  recent: {
    keys: [conversations.lastMessageAt, conversations.id],
    ascending: false,
  },
  oldest: {
    keys: [conversations.lastMessageAt, conversations.id],
    ascending: true,
  },
  created: {
    keys: [conversations.createdAt, conversations.id],
    ascending: false,
  },
  waiting: { keys: [waiting, conversations.id], ascending: true },
  priority: {
    keys: [rank, conversations.lastMessageAt, conversations.id],
    ascending: false,
  },
};

/** Rows strictly after the cursor row in the sort's order. The cursor row is compared in SQL, so sub-millisecond times stay exact. */
const afterCursor = (
  sort: ListFilters["sort"],
  cursor: NonNullable<ListFilters["cursor"]>,
) => {
  const { keys, ascending } = sorts[sort];
  const list = sql.join(keys, sql`, `);
  return sql`(${list}) ${ascending ? sql`>` : sql`<`} (select ${list} from ${conversations} where ${eq(conversations.id, cursor)})`;
};

const escapeLike = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
/** Not ended as spam: the inbox list's rule outside the spam view. */
export const notSpam = or(
  isNull(conversations.endReason),
  ne(conversations.endReason, "spam"),
);

function conditions(
  db: Database,
  actor: QuillsActor,
  filters: Omit<ListFilters, "sort" | "cursor" | "limit">,
): SQL {
  const search = filters.search && escapeLike(filters.search);
  return and(
    realConversation,
    // A spam-ended thread leaves every triage view; only the spam view lists it.
    filters.view === "spam"
      ? and(
          eq(conversations.status, "closed"),
          eq(conversations.endReason, "spam"),
        )
      : notSpam,
    filters.status ? eq(conversations.status, filters.status) : undefined,
    filters.priority ? eq(conversations.priority, filters.priority) : undefined,
    filters.assignee === "mine"
      ? eq(conversations.assignedAgentPrincipalId, actor.principalId)
      : filters.assignee === "unassigned"
        ? isNull(conversations.assignedAgentPrincipalId)
        : filters.assignee
          ? eq(conversations.assignedAgentPrincipalId, filters.assignee)
          : undefined,
    filters.teamId
      ? eq(conversations.assignedTeamId, filters.teamId)
      : undefined,
    filters.visitorPrincipalId
      ? eq(conversations.visitorPrincipalId, filters.visitorPrincipalId)
      : undefined,
    filters.channel ? eq(conversations.channel, filters.channel) : undefined,
    filters.source ? eq(conversations.source, filters.source) : undefined,
    filters.waitingOnly ? isNotNull(conversations.waitingSince) : undefined,
    filters.tagId
      ? inArray(
          conversations.id,
          db
            .select({ id: conversationTagAssignments.conversationId })
            .from(conversationTagAssignments)
            .where(
              eq(conversationTagAssignments.conversationTagId, filters.tagId),
            ),
        )
      : undefined,
    // The principal is always the caller; never a client-supplied ID.
    filters.view === "mentions"
      ? inArray(
          conversations.id,
          db
            .select({ id: conversationMessages.conversationId })
            .from(conversationMessageMentions)
            .innerJoin(
              conversationMessages,
              eq(
                conversationMessages.id,
                conversationMessageMentions.conversationMessageId,
              ),
            )
            .where(
              and(
                eq(conversationMessageMentions.principalId, actor.principalId),
                eq(conversationMessages.isInternal, true),
                isNull(conversationMessages.deletedAt),
              ),
            ),
        )
      : undefined,
    // The first live message is an agent message by the caller. The ordered limit reads one row per conversation.
    filters.view === "created_by_me"
      ? sql`(select (m.sender_type = 'agent' and m.principal_id = ${sql.param(actor.principalId, conversationMessages.principalId)}) from ${conversationMessages} m where m.conversation_id = ${conversations.id} and m.deleted_at is null order by m.created_at, m.id limit 1)`
      : undefined,
    search
      ? or(
          sql`${conversations.subject} ilike ${search}`,
          sql`coalesce(${user.name}, ${principal.displayName}) ilike ${search}`,
          exists(
            db
              .select({ one: sql`1` })
              .from(conversationMessages)
              .where(
                and(
                  sql`${conversationMessages.conversationId} = ${conversations.id}`,
                  isNull(conversationMessages.deletedAt),
                  sql`${conversationMessages.content} ilike ${search}`,
                ),
              ),
          ),
        )
      : undefined,
  )!;
}

/** One page of conversations. A cursor is a conversation of this workspace; a missing one is 404. */
export async function listConversations(
  db: Database,
  actor: QuillsActor,
  filters: ListFilters,
) {
  if (filters.cursor) await findConversation(db, filters.cursor);
  const { keys, ascending } = sorts[filters.sort];
  const rows = await selectConversations(
    db,
    and(
      conditions(db, actor, filters),
      filters.cursor ? afterCursor(filters.sort, filters.cursor) : undefined,
    ),
  )
    .orderBy(
      ...keys.map((key) => (ascending ? sql`${key} asc` : sql`${key} desc`)),
    )
    .limit(filters.limit + 1);
  const hasMore = rows.length > filters.limit;
  const items = await toItems(db, rows.slice(0, filters.limit));
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null, hasMore };
}

/** Open, real, non-spam conversations: the queue the inbox counts. */
export const openQueue = and(
  realConversation,
  eq(conversations.status, "open"),
  notSpam,
)!;
