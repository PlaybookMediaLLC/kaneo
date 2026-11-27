import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { tickets } from "../../database/quills/schema/tickets";
import { defineQuillsRoute } from "../framework/define-route";
import { realConversation } from "../support/conversation-model";
import { resolveAllowedTeamIds } from "../support/team-scope";
import { testRequester } from "../support/ticket-list";

const reopenReportSchema = z.object({
  days: z.number().int(),
  conversations: z.object({
    resolvedCount: z.number().int(),
    reopenedCount: z.number().int(),
    reopenRatePercent: z.number(),
    topReopened: z.array(
      z.object({
        id: z.string(),
        subject: z.string().nullable(),
        reopenedCount: z.number().int(),
        updatedAt: responseTimestamp.nullable(),
      }),
    ),
  }),
  tickets: z.object({
    resolvedCount: z.number().int(),
    reopenedCount: z.number().int(),
    reopenRatePercent: z.number(),
    topReopened: z.array(
      z.object({
        id: z.string(),
        number: z.number(),
        title: z.string(),
        reopenedCount: z.number().int(),
        updatedAt: responseTimestamp,
      }),
    ),
  }),
});

const getReopenReport = defineQuillsRoute({
  method: "get",
  path: "/reporting/support/reopens",
  operationId: "getQuillsReopenReport",
  summary: "Get ticket and conversation reopen counts and rates (#311)",
  action: "read",
  callerActions: true,
  query: z.object({
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
  response: reopenReportSchema,
  responseDescription: "Reopen metrics over the requested window",
  handler: async ({ db, workspaceId, actor, actions, query }) => {
    const allowedTeamIds = await resolveAllowedTeamIds(
      db,
      workspaceId,
      actor,
      actions,
    );
    const convTeamFilter =
      allowedTeamIds === null
        ? undefined
        : allowedTeamIds.length === 0
          ? sql`false`
          : inArray(conversations.assignedTeamId, allowedTeamIds);
    const ticketTeamFilter =
      allowedTeamIds === null
        ? undefined
        : allowedTeamIds.length === 0
          ? sql`false`
          : inArray(tickets.assigneeTeamId, allowedTeamIds);
    const since = new Date(Date.now() - query.days * 86_400_000);
    const convScope = and(
      gt(conversations.createdAt, since),
      realConversation,
      sql`coalesce(${conversations.endReason}, '') <> 'spam'`,
      convTeamFilter,
    );
    const [convSummary] = await db
      .select({
        resolvedCount: sql<number>`count(*) filter (where ${conversations.resolvedAt} is not null or ${conversations.reopenedCount} > 0)::int`,
        reopenedCount: sql<number>`count(*) filter (where ${conversations.reopenedCount} > 0)::int`,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(convScope);
    const topConvs = await db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        reopenedCount: conversations.reopenedCount,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(and(convScope, gt(conversations.reopenedCount, 0)))
      .orderBy(desc(conversations.reopenedCount), desc(conversations.updatedAt))
      .limit(10);

    const ticketScope = and(
      isNull(tickets.deletedAt),
      gt(tickets.createdAt, since),
      sql`not ${testRequester}`,
      ticketTeamFilter,
    );
    const [ticketSummary] = await db
      .select({
        resolvedCount: sql<number>`count(*) filter (where ${tickets.resolvedAt} is not null or ${tickets.reopenedCount} > 0)::int`,
        reopenedCount: sql<number>`count(*) filter (where ${tickets.reopenedCount} > 0)::int`,
      })
      .from(tickets)
      .where(ticketScope);
    const topTickets = await db
      .select({
        id: tickets.id,
        number: tickets.number,
        title: tickets.title,
        reopenedCount: tickets.reopenedCount,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .where(and(ticketScope, gt(tickets.reopenedCount, 0)))
      .orderBy(desc(tickets.reopenedCount), desc(tickets.updatedAt))
      .limit(10);

    const rate = (reopened: number, resolved: number) =>
      resolved > 0 ? Math.round((reopened / resolved) * 1000) / 10 : 0;

    return {
      days: query.days,
      conversations: {
        resolvedCount: convSummary?.resolvedCount ?? 0,
        reopenedCount: convSummary?.reopenedCount ?? 0,
        reopenRatePercent: rate(
          convSummary?.reopenedCount ?? 0,
          convSummary?.resolvedCount ?? 0,
        ),
        topReopened: topConvs,
      },
      tickets: {
        resolvedCount: ticketSummary?.resolvedCount ?? 0,
        reopenedCount: ticketSummary?.reopenedCount ?? 0,
        reopenRatePercent: rate(
          ticketSummary?.reopenedCount ?? 0,
          ticketSummary?.resolvedCount ?? 0,
        ),
        topReopened: topTickets,
      },
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...getReopenReport,
);
