import {
  and,
  asc,
  count as countOf,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { conversations } from "../../database/quills/schema/conversation";
import { feedbackSignals } from "../../database/quills/schema/feedback-signals";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { tickets } from "../../database/quills/schema/tickets";
import { bothVisible } from "../assistant/suggestions";
import { filterConditions } from "../feedback/post-filters";
import { readable } from "../feedback/signals";
import { loadProjects } from "../feedback/visibility";
import { defineQuillsRoute } from "../framework/define-route";
import { openQueue } from "../support/conversation-list";
import { statusIn } from "../support/ticket-list";

// The counts of the teammate app navigation (RFC 0004). Each count uses the rule of the list that
// it counts, so a count never includes a row that the caller cannot read in that list.

const count = z.number().int().nonnegative();
// ponytail: the first 100 open statuses; a workspace has far fewer.
const MAX_STATUSES = 100;

const teamCounts = defineQuillsRoute({
  method: "get",
  path: "/reporting/team-counts",
  operationId: "getQuillsTeamCounts",
  summary: "Count the views of the teammate app",
  description:
    "Open conversations assigned to the caller, unassigned, waiting for a team reply (the queue) and in total (test customers and spam not counted, as in the inbox counts); the posts of each live status in the active category, in position order, as `getQuillsPostFilterCounts` counts them; live tickets in an open status, as `listQuillsTickets` with `statusCategory=open`; pending merge suggestions whose two posts are visible to you; pending feedback signals that the autopilot list shows.",
  action: "read",
  load: loadProjects,
  response: z.object({
    myConversations: count,
    unassignedConversations: count,
    openConversations: count,
    queueConversations: count,
    openTickets: count,
    pendingDuplicates: count,
    pendingSignals: count,
    postStatuses: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          color: z.string(),
          count,
        }),
      )
      .max(MAX_STATUSES),
  }),
  responseDescription: "Counts",
  handler: async ({ db, actor, loaded }) => {
    const [queue] = await db
      .select({
        mine: sql<number>`count(*) filter (where ${eq(conversations.assignedAgentPrincipalId, actor.principalId)})::int`,
        unassigned: sql<number>`count(*) filter (where ${isNull(conversations.assignedAgentPrincipalId)})::int`,
        open: sql<number>`count(*)::int`,
        queue: sql<number>`count(*) filter (where ${conversations.waitingSince} is not null)::int`,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(openQueue);
    const statuses = await db
      .select({
        id: postStatuses.id,
        name: postStatuses.name,
        color: postStatuses.color,
      })
      .from(postStatuses)
      .where(
        and(
          isNull(postStatuses.deletedAt),
          eq(postStatuses.category, "active"),
        ),
      )
      .orderBy(asc(postStatuses.position), asc(postStatuses.id))
      .limit(MAX_STATUSES);
    const perStatus = statuses.length
      ? await db
          .select({ id: posts.statusId, count: countOf() })
          .from(posts)
          .innerJoin(boards, eq(boards.id, posts.boardId))
          .where(
            and(
              filterConditions(db, { showDeleted: "false" }, loaded),
              inArray(
                posts.statusId,
                statuses.map((status) => status.id),
              ),
            ),
          )
          .groupBy(posts.statusId)
      : [];
    const postCount = new Map(perStatus.map((row) => [row.id, row.count]));
    return {
      myConversations: queue?.mine ?? 0,
      unassignedConversations: queue?.unassigned ?? 0,
      openConversations: queue?.open ?? 0,
      queueConversations: queue?.queue ?? 0,
      openTickets: await db.$count(
        tickets,
        and(isNull(tickets.deletedAt), statusIn(db, "category", "open")),
      ),
      pendingDuplicates: await db.$count(
        mergeSuggestions,
        and(eq(mergeSuggestions.status, "pending"), bothVisible(db, loaded)),
      ),
      pendingSignals: await db.$count(
        feedbackSignals,
        and(eq(feedbackSignals.status, "pending"), readable),
      ),
      postStatuses: statuses.map((status) => ({
        ...status,
        count: postCount.get(status.id) ?? 0,
      })),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...teamCounts,
);
