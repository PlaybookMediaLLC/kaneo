import { asc, eq, isNull, sql } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { defineQuillsRoute } from "../framework/define-route";
import { listConversations, listFilters, openQueue } from "./conversation-list";
import { conversationItem, errors } from "./conversation-model";

// The unified inbox. This slice serves its conversation branch; tickets join with the tickets slice.

const facets = {
  open: "open",
  waiting: "snoozed",
  closed: "closed",
  all: undefined,
} as const;

const listInbox = defineQuillsRoute({
  method: "get",
  path: "/inbox",
  operationId: "listQuillsInboxItems",
  summary: "List the inbox",
  description:
    "The conversation filters, with a triage facet in place of the status: open, waiting (snoozed), closed or all. Items carry their kind; only conversations are listed until tickets join.",
  action: "read",
  query: listFilters.omit({ status: true }).extend({
    facet: z.enum(["open", "waiting", "closed", "all"]).default("open"),
  }),
  response: z.object({
    items: z.array(
      z.object({
        kind: z.literal("conversation"),
        conversation: conversationItem,
      }),
    ),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of inbox items",
  errors,
  handler: async ({ db, actor, query: { facet, ...filters } }) => {
    const page = await listConversations(db, actor, {
      ...filters,
      status: facets[facet],
    });
    return {
      ...page,
      items: page.items.map((conversation) => ({
        kind: "conversation" as const,
        conversation,
      })),
    };
  },
});

const inboxCounts = defineQuillsRoute({
  method: "get",
  path: "/inbox/counts",
  operationId: "fetchQuillsInboxCounts",
  summary: "Count the open inbox queues",
  description:
    "Open conversations assigned to the caller and unassigned ones, without test and spam conversations. They match the list with facet=open and assignee=mine or unassigned.",
  action: "read",
  response: z.object({ mine: z.number(), unassigned: z.number() }),
  responseDescription: "Counts",
  errors,
  handler: async ({ db, actor }) => {
    const [row] = await db
      .select({
        mine: sql<number>`count(*) filter (where ${eq(conversations.assignedAgentPrincipalId, actor.principalId)})::int`,
        unassigned: sql<number>`count(*) filter (where ${isNull(conversations.assignedAgentPrincipalId)})::int`,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(openQueue);
    return { mine: row?.mine ?? 0, unassigned: row?.unassigned ?? 0 };
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
