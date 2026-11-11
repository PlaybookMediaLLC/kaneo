// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import type { Database, QuillsActor } from "../framework/define-route";
import {
  notFound,
  ticketViews,
  type CATEGORIES,
  type PRIORITIES,
  type STAGES,
  type TICKET_KINDS,
} from "./ticket-view";

// The teammate ticket list: filters, four sorts and a keyset cursor re-read from the database.
// The tickets route and the unified inbox's ticket branch share it.

export const rank = sql<number>`case ${tickets.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
const sorts = {
  recent: { key: tickets.updatedAt, dir: "desc" },
  oldest: { key: tickets.updatedAt, dir: "asc" },
  created: { key: tickets.createdAt, dir: "desc" },
  priority: { key: rank, dir: "desc" },
} as const;

export type TicketFilters = {
  type?: (typeof TICKET_KINDS)[number];
  ticketTypeId?: TypeId<"ticket_type">;
  statusCategory?: (typeof CATEGORIES)[number];
  stage?: (typeof STAGES)[number];
  priority?: (typeof PRIORITIES)[number];
  assignee?: "me" | "unassigned" | TypeId<"principal">;
  teamId?: TypeId<"team">;
  requesterPrincipalId?: TypeId<"principal">;
  companyId?: TypeId<"company">;
  search?: string;
  sort: keyof typeof sorts;
  cursor?: TypeId<"ticket">;
  limit: number;
  /** The unified inbox: a customer ticket with a linked conversation lists as that conversation. */
  excludeConversationLinked?: boolean;
  /** The unified inbox: leaves out tickets whose requester is a teammate's test customer. */
  realOnly?: boolean;
};

/** A customer ticket with a conversation link: the inbox lists it once, as its conversation. */
export const conversationLinked = sql`(${tickets.type} = 'customer' and exists (select 1 from ${ticketConversations} tc where tc.ticket_id = ${tickets.id}))`;
/** The requester is a teammate's test customer. */
export const testRequester = sql`exists (select 1 from ${principal} test_requester where test_requester.id = ${tickets.requesterPrincipalId} and test_requester.test_owner_principal_id is not null)`;

/** Tickets in a status of `column = value`. */
export const statusIn = (
  db: Database,
  column: "category" | "publicStage",
  value: string,
) =>
  inArray(
    tickets.statusId,
    db
      .select({ id: ticketStatuses.id })
      .from(ticketStatuses)
      .where(eq(ticketStatuses[column], value as never)),
  );

/** One page of live tickets. A cursor is a live ticket of this workspace; a missing one is 404. */
export async function listTicketPage(
  db: Database,
  actor: QuillsActor,
  query: TicketFilters,
) {
  const sort = sorts[query.sort];
  const before = sort.dir === "desc" ? sql.raw("<") : sql.raw(">");
  let after;
  if (query.cursor) {
    // Compared in PostgreSQL so microsecond timestamps keep their order.
    const [cursor] = await db
      .select({
        key: sql<string>`${sort.key}::text`,
        id: sql<string>`${tickets.id}::text`,
      })
      .from(tickets)
      .where(and(eq(tickets.id, query.cursor), isNull(tickets.deletedAt)));
    if (!cursor) throw notFound("Ticket");
    const cast = sort.key === rank ? sql.raw("int") : sql.raw("timestamptz");
    after = sql`(${sort.key}, ${tickets.id}) ${before} (${cursor.key}::${cast}, ${cursor.id}::uuid)`;
  }
  const search = query.search;
  const number = search && /^#?(\d{1,15})$/.exec(search)?.[1];
  const rows = await db
    .select()
    .from(tickets)
    .where(
      and(
        isNull(tickets.deletedAt),
        query.type && eq(tickets.type, query.type),
        query.ticketTypeId && eq(tickets.ticketTypeId, query.ticketTypeId),
        query.priority && eq(tickets.priority, query.priority),
        query.statusCategory && statusIn(db, "category", query.statusCategory),
        query.stage && statusIn(db, "publicStage", query.stage),
        query.assignee === "me"
          ? eq(tickets.assigneePrincipalId, actor.principalId)
          : query.assignee === "unassigned"
            ? isNull(tickets.assigneePrincipalId)
            : query.assignee && eq(tickets.assigneePrincipalId, query.assignee),
        query.teamId && eq(tickets.assigneeTeamId, query.teamId),
        query.requesterPrincipalId &&
          eq(tickets.requesterPrincipalId, query.requesterPrincipalId),
        query.companyId && eq(tickets.companyId, query.companyId),
        search
          ? or(
              ilike(tickets.title, `%${search.replace(/[\\%_]/g, "\\$&")}%`),
              number ? eq(tickets.number, Number(number)) : undefined,
            )
          : undefined,
        query.excludeConversationLinked
          ? sql`not ${conversationLinked}`
          : undefined,
        query.realOnly ? sql`not ${testRequester}` : undefined,
        after,
      ),
    )
    .orderBy(
      sort.dir === "desc" ? desc(sort.key) : asc(sort.key),
      sort.dir === "desc" ? desc(tickets.id) : asc(tickets.id),
    )
    .limit(query.limit + 1);
  const hasMore = rows.length > query.limit;
  const items = await ticketViews(db, rows.slice(0, query.limit));
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null, hasMore };
}
