import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isTypeId, type TypeId } from "@kaneo/ids";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { segments, userSegments } from "../../database/quills/schema/segments";
import {
  ticketConversations,
  tickets,
} from "../../database/quills/schema/tickets";
import { defineQuillsRoute } from "../framework/define-route";
import { listConversations, listFilters, openQueue } from "./conversation-list";
import { conversationItem, errors } from "./conversation-model";
import {
  conversationLinked,
  listTicketPage,
  statusIn,
  testRequester,
} from "./ticket-list";
import { ticketSchema } from "./ticket-view";

// The unified inbox (the source's inbox.query.ts): the conversation and ticket branches, each
// paged by its own keyset cursor, merged into one page. A customer ticket with a linked
// conversation lists once, as that conversation. Test customers' threads stay out, as in the lists.

const facets = {
  open: { conversation: "open", ticket: "open" },
  waiting: { conversation: "snoozed", ticket: "pending" },
  closed: { conversation: "closed", ticket: "closed" },
  all: { conversation: undefined, ticket: undefined },
} as const;
const RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

type Cursor = {
  c: TypeId<"conversation"> | null;
  t: TypeId<"ticket"> | null;
};
const badCursor = () => new HTTPException(400, { message: "Invalid cursor" });
/** The opaque cursor carries each branch's own keyset cursor. */
function readCursor(value: string | undefined): Cursor {
  if (!value) return { c: null, t: null };
  let parsed: { c?: unknown; t?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw badCursor();
  }
  const { c = null, t = null } = parsed ?? {};
  if (
    (c !== null && (typeof c !== "string" || !isTypeId(c, "conversation"))) ||
    (t !== null && (typeof t !== "string" || !isTypeId(t, "ticket")))
  )
    throw badCursor();
  return { c, t } as Cursor;
}
const writeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

type Item =
  | {
      kind: "conversation";
      conversation: Awaited<
        ReturnType<typeof listConversations>
      >["items"][number];
    }
  | {
      kind: "ticket";
      ticket: Awaited<ReturnType<typeof listTicketPage>>["items"][number];
    };
const time = (value: Date | string | null | undefined) =>
  value ? new Date(value).getTime() : 0;
const activity = (item: Item) =>
  item.kind === "conversation"
    ? time(item.conversation.lastMessageAt ?? item.conversation.createdAt)
    : time(item.ticket.updatedAt);
const created = (item: Item) =>
  time(
    item.kind === "conversation"
      ? item.conversation.createdAt
      : item.ticket.createdAt,
  );
const priority = (item: Item) =>
  RANK[
    item.kind === "conversation"
      ? item.conversation.priority
      : item.ticket.priority
  ] ?? 0;
/** True when `a` comes before `b`: each branch keeps its own order; a tie goes to the conversation. */
const before = {
  recent: (a: Item, b: Item) => activity(a) >= activity(b),
  oldest: (a: Item, b: Item) => activity(a) <= activity(b),
  created: (a: Item, b: Item) => created(a) >= created(b),
  priority: (a: Item, b: Item) =>
    priority(a) > priority(b) ||
    (priority(a) === priority(b) && activity(a) >= activity(b)),
};

const listInbox = defineQuillsRoute({
  method: "get",
  path: "/inbox",
  operationId: "listQuillsInboxItems",
  summary: "List the inbox: conversations and tickets",
  description:
    "Conversations and tickets in one page, newest activity first (a conversation's last message, a ticket's last change). `facet` maps to a conversation status (waiting = snoozed) and a ticket status category (waiting = pending). A customer ticket with a linked conversation lists as that conversation. A conversation-only filter (visitor, tag, channel, source, waitingOnly or a view) lists conversations only. Pass `nextCursor` as `cursor` for the next page.",
  action: "read",
  query: listFilters.omit({ status: true, sort: true, cursor: true }).extend({
    facet: z.enum(["open", "waiting", "closed", "all"]).default("open"),
    kind: z.enum(["conversation", "ticket"]).optional(),
    sort: z.enum(["recent", "oldest", "created", "priority"]).default("recent"),
    cursor: z.string().min(1).max(300).optional(),
  }),
  response: z.object({
    // One closed object: `conversation` is set for a conversation item, `ticket` for a ticket item.
    items: z.array(
      z.object({
        kind: z.enum(["conversation", "ticket"]),
        conversation: conversationItem.optional(),
        ticket: ticketSchema.optional(),
      }),
    ),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of inbox items",
  errors,
  handler: async ({
    db,
    actor,
    query: { facet, kind, cursor: token, ...filters },
  }) => {
    const cursor = readCursor(token);
    const conversationOnly = Boolean(
      filters.visitorPrincipalId ||
      filters.tagId ||
      filters.channel ||
      filters.source ||
      filters.waitingOnly ||
      filters.view !== "all",
    );
    const conversationPage =
      kind === "ticket"
        ? { items: [], hasMore: false }
        : await listConversations(db, actor, {
            ...filters,
            status: facets[facet].conversation,
            cursor: cursor.c ?? undefined,
          });
    const ticketPage =
      kind === "conversation" || conversationOnly
        ? { items: [], hasMore: false }
        : await listTicketPage(db, actor, {
            statusCategory: facets[facet].ticket,
            priority: filters.priority,
            assignee: filters.assignee === "mine" ? "me" : filters.assignee,
            teamId: filters.teamId,
            search: filters.search || undefined,
            sort: filters.sort,
            cursor: cursor.t ?? undefined,
            limit: filters.limit,
            excludeConversationLinked: true,
            realOnly: true,
          });
    const left: Item[] = conversationPage.items.map((conversation) => ({
      kind: "conversation",
      conversation,
    }));
    const right: Item[] = ticketPage.items.map((ticket) => ({
      kind: "ticket",
      ticket,
    }));
    const items: Item[] = [];
    while (items.length < filters.limit && (left.length || right.length))
      items.push(
        !right.length ||
          (left.length && before[filters.sort](left[0]!, right[0]!))
          ? left.shift()!
          : right.shift()!,
      );
    const hasMore =
      conversationPage.hasMore ||
      ticketPage.hasMore ||
      left.length > 0 ||
      right.length > 0;
    const last = (wanted: Item["kind"]) =>
      [...items].reverse().find((item) => item.kind === wanted);
    const lastConversation = last("conversation");
    const lastTicket = last("ticket");
    return {
      items,
      nextCursor: hasMore
        ? writeCursor({
            c:
              lastConversation?.kind === "conversation"
                ? lastConversation.conversation.id
                : cursor.c,
            t:
              lastTicket?.kind === "ticket"
                ? (lastTicket.ticket.id as TypeId<"ticket">)
                : cursor.t,
          })
        : null,
      hasMore,
    };
  },
});

const inboxCounts = defineQuillsRoute({
  method: "get",
  path: "/inbox/counts",
  operationId: "fetchQuillsInboxCounts",
  summary: "Count the open inbox queues",
  description:
    "Open conversations assigned to the caller and unassigned ones; open tickets by type, where the customer count includes open conversations paired with a customer ticket (a pair counts once, as in the list); and test conversations in any status. Test customers' threads and spam are not counted in the queues.",
  action: "read",
  response: z.object({
    mine: z.number(),
    unassigned: z.number(),
    ticketsByType: z.object({
      customer: z.number(),
      back_office: z.number(),
      tracker: z.number(),
    }),
    test: z.number(),
  }),
  responseDescription: "Counts",
  errors,
  handler: async ({ db, actor }) => {
    const test = sql`${principal.testOwnerPrincipalId} is not null`;
    const [row] = await db
      .select({
        mine: sql<number>`count(*) filter (where ${openQueue} and ${eq(conversations.assignedAgentPrincipalId, actor.principalId)})::int`,
        unassigned: sql<number>`count(*) filter (where ${openQueue} and ${isNull(conversations.assignedAgentPrincipalId)})::int`,
        pair: sql<number>`count(*) filter (where ${openQueue} and exists (select 1 from ${ticketConversations} tc where tc.conversation_id = ${conversations.id} and tc.ticket_type = 'customer'))::int`,
        test: sql<number>`count(*) filter (where ${test})::int`,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(or(openQueue, test));
    const byType = await db
      .select({ type: tickets.type, count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(
        and(
          isNull(tickets.deletedAt),
          statusIn(db, "category", "open"),
          sql`not ${conversationLinked}`,
          sql`not ${testRequester}`,
        ),
      )
      .groupBy(tickets.type);
    const count = (type: string) =>
      byType.find((entry) => entry.type === type)?.count ?? 0;
    return {
      mine: row?.mine ?? 0,
      unassigned: row?.unassigned ?? 0,
      ticketsByType: {
        customer: count("customer") + (row?.pair ?? 0),
        back_office: count("back_office"),
        tracker: count("tracker"),
      },
      test: row?.test ?? 0,
    };
  },
});

const inboxSegments = defineQuillsRoute({
  method: "get",
  path: "/inbox/segments",
  operationId: "fetchQuillsInboxSegmentsWithCounts",
  summary: "List segments with their open conversation counts",
  description:
    "Live segments by name, each with the open conversations whose visitor is a member (test and spam conversations not counted).",
  action: "read",
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        count: z.number(),
      }),
    ),
  }),
  responseDescription: "Segments",
  errors,
  handler: async ({ db }) => {
    // Start from the open queue (small), not from every segment membership.
    const counted = db
      .select({
        segmentId: userSegments.segmentId,
        count: sql<number>`count(distinct ${conversations.id})::int`.as(
          "count",
        ),
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .innerJoin(
        userSegments,
        eq(userSegments.principalId, conversations.visitorPrincipalId),
      )
      .where(openQueue)
      .groupBy(userSegments.segmentId)
      .as("counted");
    const rows = await db
      .select({
        id: segments.id,
        name: segments.name,
        color: segments.color,
        count: sql<number>`coalesce(${counted.count}, 0)::int`,
      })
      .from(segments)
      .leftJoin(counted, eq(counted.segmentId, segments.id))
      .where(isNull(segments.deletedAt))
      .orderBy(asc(segments.name))
      .limit(500);
    return { items: rows };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listInbox)
  .openapi(...inboxCounts)
  .openapi(...inboxSegments);
