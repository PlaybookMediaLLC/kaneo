import { and, eq, isNull, sql } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { feedbackSignals } from "../../database/quills/schema/feedback-signals";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { tickets } from "../../database/quills/schema/tickets";
import { bothVisible } from "../assistant/suggestions";
import { readable } from "../feedback/signals";
import { loadProjects } from "../feedback/visibility";
import { defineQuillsRoute } from "../framework/define-route";
import { openQueue } from "../support/conversation-list";
import { statusIn } from "../support/ticket-list";

// The counts of the teammate app navigation (RFC 0004). Each count uses the rule of the list that
// it counts, so a count never includes a row that the caller cannot read in that list.

const count = z.number().int().nonnegative();

const teamCounts = defineQuillsRoute({
  method: "get",
  path: "/reporting/team-counts",
  operationId: "getQuillsTeamCounts",
  summary: "Count the views of the teammate app",
  description:
    "Open conversations assigned to the caller, unassigned and in total (test customers and spam not counted, as in the inbox counts); live tickets in an open status, as `listQuillsTickets` with `statusCategory=open`; pending merge suggestions whose two posts are visible to you; pending feedback signals that the autopilot list shows.",
  action: "read",
  load: loadProjects,
  response: z.object({
    myConversations: count,
    unassignedConversations: count,
    openConversations: count,
    openTickets: count,
    pendingDuplicates: count,
    pendingSignals: count,
  }),
  responseDescription: "Counts",
  handler: async ({ db, actor, loaded }) => {
    const [queue] = await db
      .select({
        mine: sql<number>`count(*) filter (where ${eq(conversations.assignedAgentPrincipalId, actor.principalId)})::int`,
        unassigned: sql<number>`count(*) filter (where ${isNull(conversations.assignedAgentPrincipalId)})::int`,
        open: sql<number>`count(*)::int`,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(openQueue);
    return {
      myConversations: queue?.mine ?? 0,
      unassignedConversations: queue?.unassigned ?? 0,
      openConversations: queue?.open ?? 0,
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
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...teamCounts,
);
