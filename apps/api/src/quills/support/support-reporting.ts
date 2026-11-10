import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { slaEvents, slaPolicies } from "../../database/quills/schema/sla";
import { defineQuillsRoute } from "../framework/define-route";

const CLOCKS = [
  ["firstResponse", "first_response"],
  ["nextResponse", "next_response"],
  ["resolution", "resolution"],
  ["timeToResolve", "time_to_resolve"],
] as const;
type Clock = (typeof CLOCKS)[number][0];
const DAY = 86400000;

// Test customers' records stay out of reports (database/quills/test-data.ts has the same rule).
const realConversation = sql`not exists (
  select 1 from quills."conversations" tc
  join quills."principal" tp on tp.id = tc.visitor_principal_id and tp.workspace_id = tc.workspace_id
  where tc.id = ${slaEvents.conversationId} and tp.test_owner_principal_id is not null)`;
const realTicket = sql`not exists (
  select 1 from quills."tickets" tt where tt.id = ${slaEvents.ticketId} and (
    exists (select 1 from quills."principal" tp where tp.id = tt.requester_principal_id
      and tp.workspace_id = tt.workspace_id and tp.test_owner_principal_id is not null)
    or exists (select 1 from quills."ticket_conversations" tl
      join quills."conversations" tc on tc.id = tl.conversation_id and tc.workspace_id = tl.workspace_id
      join quills."principal" tp on tp.id = tc.visitor_principal_id and tp.workspace_id = tc.workspace_id
      where tl.ticket_id = tt.id and tl.workspace_id = tt.workspace_id and tp.test_owner_principal_id is not null)))`;

const attainment = z.object({
  met: z.number(),
  breached: z.number(),
  rate: z.number().nullable(),
});
const clocks = <T extends z.ZodType>(item: T) =>
  z.object({
    firstResponse: item,
    nextResponse: item,
    resolution: item,
    timeToResolve: item,
  });

function fold(rows: { kind: string; n: number }[]) {
  const n = (kind: string) =>
    rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.n, 0);
  return Object.fromEntries(
    CLOCKS.map(([key, prefix]) => {
      const met = n(`${prefix}_met`);
      const breached = n(`${prefix}_breached`);
      return [
        key,
        { met, breached, rate: met + breached ? met / (met + breached) : null },
      ];
    }),
  ) as Record<Clock, z.input<typeof attainment>>;
}

const reporting = defineQuillsRoute({
  method: "get",
  path: "/support/reporting",
  operationId: "getQuillsSupportReporting",
  summary: "Get SLA reporting for a date range",
  description:
    "Counts SLA events in [from, to), at most 400 days. Test customers' conversations and tickets are left out. The heatmap uses UTC days (ISO 1 = Monday) and hours.",
  action: "read",
  query: z
    .object({
      from: z.iso.datetime({ offset: true }),
      to: z.iso.datetime({ offset: true }),
    })
    .refine((q) => {
      const span = Date.parse(q.to) - Date.parse(q.from);
      return span > 0 && span <= 400 * DAY;
    }, "`to` must be after `from` and at most 400 days later"),
  response: z.object({
    sla: clocks(attainment),
    slaByPolicy: z.array(
      clocks(attainment).extend({
        policyId: z.string(),
        policyName: z.string(),
      }),
    ),
    slaHeatmap: z.array(
      z.object({
        dow: z.number(),
        hour: z.number(),
        count: z.number(),
        byClock: clocks(z.number()),
      }),
    ),
    slaTimeAfterMiss: clocks(
      z.object({ count: z.number(), avgOverdueSecs: z.number().nullable() }),
    ),
  }),
  responseDescription:
    "SLA attainment, per policy, by hour and time after a miss",
  handler: async ({ db, query }) => {
    const range = and(
      gte(slaEvents.at, new Date(query.from)),
      lt(slaEvents.at, new Date(query.to)),
      realConversation,
      realTicket,
    );
    const totals = await db
      .select({ kind: slaEvents.kind, n: count() })
      .from(slaEvents)
      .where(range)
      .groupBy(slaEvents.kind);
    const perPolicy = await db
      .select({
        policyId: slaEvents.policyId,
        policyName: slaPolicies.name,
        kind: slaEvents.kind,
        n: count(),
      })
      .from(slaEvents)
      .innerJoin(slaPolicies, eq(slaPolicies.id, slaEvents.policyId))
      .where(range)
      .groupBy(slaEvents.policyId, slaPolicies.name, slaEvents.kind)
      .orderBy(slaPolicies.name);
    const dow = sql<number>`extract(isodow from (${slaEvents.at} at time zone 'UTC'))::int`;
    const hour = sql<number>`extract(hour from (${slaEvents.at} at time zone 'UTC'))::int`;
    const breaches = await db
      .select({ dow, hour, kind: slaEvents.kind, n: count() })
      .from(slaEvents)
      .where(
        and(
          range,
          inArray(
            slaEvents.kind,
            CLOCKS.map(([, p]) => `${p}_breached`),
          ),
        ),
      )
      .groupBy(dow, hour, slaEvents.kind);
    const late = await db
      .select({
        kind: slaEvents.kind,
        n: count(),
        avg: sql<
          number | null
        >`avg((${slaEvents.meta}->>'overdueSecs')::numeric)::float`,
      })
      .from(slaEvents)
      .where(
        and(
          range,
          inArray(
            slaEvents.kind,
            CLOCKS.map(([, p]) => `${p}_settled_after_breach`),
          ),
        ),
      )
      .groupBy(slaEvents.kind);

    const policies = new Map<
      string,
      { policyId: string; policyName: string; rows: typeof perPolicy }
    >();
    for (const row of perPolicy) {
      const entry = policies.get(row.policyId) ?? {
        policyId: row.policyId,
        policyName: row.policyName,
        rows: [],
      };
      entry.rows.push(row);
      policies.set(row.policyId, entry);
    }
    const cells = new Map<
      string,
      {
        dow: number;
        hour: number;
        count: number;
        byClock: Record<Clock, number>;
      }
    >();
    for (const row of breaches) {
      const key = `${row.dow}:${row.hour}`;
      const cell = cells.get(key) ?? {
        dow: row.dow,
        hour: row.hour,
        count: 0,
        byClock: {
          firstResponse: 0,
          nextResponse: 0,
          resolution: 0,
          timeToResolve: 0,
        },
      };
      cell.count += row.n;
      const clock = CLOCKS.find(([, p]) => row.kind === `${p}_breached`);
      if (clock) cell.byClock[clock[0]] += row.n;
      cells.set(key, cell);
    }
    return {
      sla: fold(totals),
      slaByPolicy: [...policies.values()].map(({ rows, ...p }) => ({
        ...p,
        ...fold(rows),
      })),
      slaHeatmap: [...cells.values()].sort(
        (a, b) => a.dow - b.dow || a.hour - b.hour,
      ),
      slaTimeAfterMiss: Object.fromEntries(
        CLOCKS.map(([key, prefix]) => {
          const row = late.find(
            (r) => r.kind === `${prefix}_settled_after_breach`,
          );
          return [
            key,
            { count: row?.n ?? 0, avgOverdueSecs: row?.avg ?? null },
          ];
        }),
      ) as Record<Clock, { count: number; avgOverdueSecs: number | null }>,
    };
  },
});

/** Teammate support reporting. */
export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...reporting,
);
