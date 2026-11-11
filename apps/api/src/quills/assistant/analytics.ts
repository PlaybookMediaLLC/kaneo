import { and, count, gte, inArray, lt, sql, sum } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { assistantInvolvements } from "../../database/quills/schema/assistant";
import { assistantEvents } from "../../database/quills/schema/assistant-events";
import {
  ASSISTANT_PENDING_ACTION_STATUSES,
  assistantPendingActions,
} from "../../database/quills/schema/assistant-pending-actions";
import { assistantToolCalls } from "../../database/quills/schema/assistant-tool-calls";
import { defineQuillsRoute } from "../framework/define-route";

// Assistant reports over a date range of at most 366 days. Aggregates only; no row content.

const range = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});
const window = ({ from, to }: z.output<typeof range>) => {
  const start = new Date(`${from}T00:00:00Z`);
  // `to` is inclusive.
  const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000);
  const days = (end.getTime() - start.getTime()) / 86400000;
  if (days < 1 || days > 366)
    throw new HTTPException(400, {
      message: "Choose a range of 1 to 366 days, `from` before `to`",
    });
  return { start, end };
};
const tally = <K extends string>(
  keys: readonly K[],
  rows: { key: string; n: number }[],
) =>
  Object.fromEntries(
    keys.map((key) => [key, rows.find((row) => row.key === key)?.n ?? 0]),
  ) as Record<K, number>;

const INVOLVEMENT = [
  "active",
  "handed_off",
  "resolved_confirmed",
  "resolved_assumed",
  "abandoned",
] as const;
const performance = defineQuillsRoute({
  method: "get",
  path: "/assistant/analytics/performance",
  operationId: "getQuillsQuinnPerformance",
  summary: "Get the customer agent's involvement and resolution counts",
  description:
    "Involvements started in the range, by status, and the tool calls that succeeded.",
  action: "read",
  query: range,
  response: z.object({
    involvements: z.number(),
    byStatus: z.object(
      Object.fromEntries(INVOLVEMENT.map((key) => [key, z.number()])) as Record<
        (typeof INVOLVEMENT)[number],
        z.ZodNumber
      >,
    ),
    resolutionRate: z.number(),
    succeededToolCalls: z.number(),
  }),
  responseDescription: "The counts",
  handler: async ({ db, query }) => {
    const { start, end } = window(query);
    const rows = await db
      .select({ key: assistantInvolvements.status, n: count() })
      .from(assistantInvolvements)
      .where(
        and(
          gte(assistantInvolvements.createdAt, start),
          lt(assistantInvolvements.createdAt, end),
        ),
      )
      .groupBy(assistantInvolvements.status);
    const byStatus = tally(INVOLVEMENT, rows);
    const involvements = rows.reduce((total, row) => total + row.n, 0);
    const succeededToolCalls = await db.$count(
      assistantToolCalls,
      and(
        sql`${assistantToolCalls.status} = 'succeeded'`,
        gte(assistantToolCalls.createdAt, start),
        lt(assistantToolCalls.createdAt, end),
      ),
    );
    return {
      involvements,
      byStatus,
      resolutionRate: involvements
        ? (byStatus.resolved_confirmed + byStatus.resolved_assumed) /
          involvements
        : 0,
      succeededToolCalls,
    };
  },
});

const TOOL_STATUSES = [
  "started",
  "succeeded",
  "failed",
  "denied",
  "skipped_duplicate",
] as const;
const toolMetrics = defineQuillsRoute({
  method: "get",
  path: "/assistant/analytics/tools",
  operationId: "getQuillsQuinnToolMetrics",
  summary: "Get the assistant's tool calls by tool and status",
  action: "read",
  query: range,
  response: z.object({
    items: z.array(
      z.object({
        toolName: z.string(),
        total: z.number(),
        succeeded: z.number(),
        failed: z.number(),
        denied: z.number(),
        averageLatencyMs: z.number().nullable(),
      }),
    ),
  }),
  responseDescription: "One entry per tool, most used first",
  handler: async ({ db, query }) => {
    const { start, end } = window(query);
    const status = (value: (typeof TOOL_STATUSES)[number]) =>
      sql<number>`count(*) FILTER (WHERE ${assistantToolCalls.status} = ${value})::int`;
    const rows = await db
      .select({
        toolName: assistantToolCalls.toolName,
        total: sql<number>`count(*)::int`,
        succeeded: status("succeeded"),
        failed: status("failed"),
        denied: status("denied"),
        averageLatencyMs: sql<
          number | null
        >`round(avg(${assistantToolCalls.latencyMs}))::int`,
      })
      .from(assistantToolCalls)
      .where(
        and(
          gte(assistantToolCalls.createdAt, start),
          lt(assistantToolCalls.createdAt, end),
        ),
      )
      .groupBy(assistantToolCalls.toolName)
      .orderBy(sql`count(*) DESC`)
      .limit(100);
    return { items: rows };
  },
});

const COPILOT_STEPS = [
  "copilot",
  "copilot_transform",
  "conversation_summary",
  "ticket_summary",
] as const;
const COPILOT_EVENTS = [
  "answer_inserted",
  "transform_inserted",
  "summary_inserted",
  "feedback",
] as const;
const ACTION_STATUSES = ASSISTANT_PENDING_ACTION_STATUSES;
const copilot = defineQuillsRoute({
  method: "get",
  path: "/assistant/analytics/copilot",
  operationId: "getQuillsCopilotUsageMetrics",
  summary: "Get copilot usage, outcomes and the proposed-action funnel",
  action: "read",
  query: range,
  response: z.object({
    calls: z.array(
      z.object({
        step: z.string(),
        calls: z.number(),
        failed: z.number(),
        totalTokens: z.number(),
      }),
    ),
    events: z.object(
      Object.fromEntries(
        COPILOT_EVENTS.map((key) => [key, z.number()]),
      ) as Record<(typeof COPILOT_EVENTS)[number], z.ZodNumber>,
    ),
    actions: z.object(
      Object.fromEntries(
        ACTION_STATUSES.map((key) => [key, z.number()]),
      ) as Record<(typeof ACTION_STATUSES)[number], z.ZodNumber>,
    ),
  }),
  responseDescription: "The counts",
  handler: async ({ db, query }) => {
    const { start, end } = window(query);
    const calls = await db
      .select({
        step: aiUsageLog.pipelineStep,
        calls: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) FILTER (WHERE ${aiUsageLog.status} <> 'success')::int`,
        totalTokens: sql<number>`coalesce(${sum(aiUsageLog.totalTokens)}, 0)::int`,
      })
      .from(aiUsageLog)
      .where(
        and(
          inArray(aiUsageLog.pipelineStep, [...COPILOT_STEPS]),
          gte(aiUsageLog.createdAt, start),
          lt(aiUsageLog.createdAt, end),
        ),
      )
      .groupBy(aiUsageLog.pipelineStep);
    const events = await db
      .select({ key: assistantEvents.eventType, n: count() })
      .from(assistantEvents)
      .where(
        and(
          inArray(assistantEvents.eventType, [...COPILOT_EVENTS]),
          gte(assistantEvents.createdAt, start),
          lt(assistantEvents.createdAt, end),
        ),
      )
      .groupBy(assistantEvents.eventType);
    const actions = await db
      .select({ key: assistantPendingActions.status, n: count() })
      .from(assistantPendingActions)
      .where(
        and(
          gte(assistantPendingActions.proposedAt, start),
          lt(assistantPendingActions.proposedAt, end),
        ),
      )
      .groupBy(assistantPendingActions.status);
    return {
      calls,
      events: tally(COPILOT_EVENTS, events),
      actions: tally(ACTION_STATUSES, actions),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...performance)
  .openapi(...toolMetrics)
  .openapi(...copilot);
