import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { StatusComponentId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../../openapi";
import {
  statusComponentEvents,
  statusComponentGroups,
  statusComponents,
  statusIncidents,
  statusSubscriptions,
  type StatusComponentStatus,
} from "../../../database/quills/schema/status";
import { defineQuillsRoute } from "../../framework/define-route";
import { readStatusSettings } from "./settings";
import {
  componentStatus,
  incident,
  incidentDetails,
  worst,
  type Db,
} from "./shared";

const DAY = 24 * 60 * 60 * 1000;
/** Statuses that do not count against uptime. */
const UP = new Set<StatusComponentStatus>(["operational", "under_maintenance"]);

const uptimeDay = z.object({
  date: z.string(),
  worstStatus: componentStatus,
  uptimePct: z.number(),
});
const uptimeSeries = z.object({
  componentId: z.string(),
  days: z.array(uptimeDay),
});

/**
 * The source's daily uptime from the append-only status log: a status holds from its event
 * until the next one. Each UTC day reports its worst status and the share of time in an up
 * status; today is clipped at `now`. `windowDays` entries, oldest first.
 */
export function uptimeDays(
  events: { status: StatusComponentStatus; createdAt: Date }[],
  initial: StatusComponentStatus,
  windowDays: number,
  now = new Date(),
) {
  const end = now.getTime();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const start = today - (windowDays - 1) * DAY;
  const days = Array.from({ length: windowDays }, () => ({
    up: 0,
    total: 0,
    top: "operational" as StatusComponentStatus,
  }));
  /** Adds one status span to the days it covers: one pass, each span touches only its own days. */
  const add = (from: number, to: number, status: StatusComponentStatus) => {
    for (let at = from; at < to;) {
      const day = Math.floor((at - start) / DAY);
      const next = Math.min(start + (day + 1) * DAY, to);
      const bucket = days[day]!;
      bucket.total += next - at;
      if (UP.has(status)) bucket.up += next - at;
      bucket.top = worst([bucket.top, status]);
      at = next;
    }
  };
  let cursor = start;
  let status = initial;
  for (const event of [...events].sort((a, b) => +a.createdAt - +b.createdAt)) {
    const at = Math.max(event.createdAt.getTime(), start);
    if (at > end) break;
    if (at > cursor) add(cursor, at, status);
    cursor = Math.max(cursor, at);
    status = event.status;
  }
  if (cursor < end) add(cursor, end, status);
  return days
    .slice(0, Math.ceil((end - start) / DAY))
    .map(({ up, total, top }, index) => ({
      date: new Date(start + index * DAY).toISOString().slice(0, 10),
      worstStatus: top,
      uptimePct: total > 0 ? Math.round((up / total) * 10000) / 100 : 100,
    }));
}

/** Uptime for the live components among `ids`, from the events in the window and the status at its start. */
export async function uptimeSeriesFor(
  db: Db,
  ids: StatusComponentId[],
  windowDays: number,
) {
  if (!ids.length) return [];
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (windowDays - 1) * DAY,
  );
  // Each live component with its status at the window start: one indexed row per component.
  const e = statusComponentEvents;
  const last = db
    .select({ status: e.status })
    .from(e)
    .where(and(eq(e.componentId, statusComponents.id), lte(e.createdAt, start)))
    .orderBy(desc(e.createdAt))
    .limit(1)
    .as("last");
  const baseline = await db
    .select({ componentId: statusComponents.id, status: last.status })
    .from(statusComponents)
    .leftJoinLateral(last, sql`true`)
    .where(
      and(
        inArray(statusComponents.id, ids),
        isNull(statusComponents.deletedAt),
      ),
    );
  if (!baseline.length) return [];
  const events = await db
    .select({
      componentId: e.componentId,
      status: e.status,
      createdAt: e.createdAt,
    })
    .from(e)
    .where(
      and(
        inArray(
          e.componentId,
          baseline.map((row) => row.componentId),
        ),
        gt(e.createdAt, start),
        lte(e.createdAt, now),
      ),
    )
    .orderBy(asc(e.createdAt));
  const byComponent = new Map<string, typeof events>();
  for (const event of events) {
    const list = byComponent.get(event.componentId);
    if (list) list.push(event);
    else byComponent.set(event.componentId, [event]);
  }
  return baseline.map(({ componentId, status }) => ({
    componentId,
    days: uptimeDays(
      byComponent.get(componentId) ?? [],
      // No history before the window reads as the column default.
      status ?? "operational",
      windowDays,
      now,
    ),
  }));
}

const getUptime = defineQuillsRoute({
  method: "get",
  path: "/status/uptime",
  operationId: "getQuillsStatusUptime",
  summary: "Get daily uptime for status components",
  description:
    "Works while the page is unpublished. Unknown and deleted components are left out.",
  action: "read",
  query: z.object({
    componentIds: z
      .string()
      .max(5000)
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(flexibleToTypeIdSchema("status_component")).min(1).max(50))
      .openapi({
        type: "string",
        description: "Comma-separated component IDs, at most 50",
      }),
    windowDays: z.coerce.number().int().min(1).max(365).default(90),
  }),
  response: z.object({ series: z.array(uptimeSeries) }),
  responseDescription: "One series per live component",
  handler: async ({ db, query }) => ({
    series: await uptimeSeriesFor(db, query.componentIds, query.windowDays),
  }),
});

const lean = z.object({
  id: z.string(),
  name: z.string(),
  status: componentStatus,
});
const getSummary = defineQuillsRoute({
  method: "get",
  path: "/status/summary",
  operationId: "getQuillsStatusSummary",
  summary: "Get the status page overview",
  description:
    "The derived page status, components, open incidents, running and upcoming maintenance (20 each), 90-day uptime and counts. Works while the page is unpublished.",
  action: "read",
  response: z.object({
    enabled: z.boolean(),
    topLevelStatus: componentStatus,
    groups: z.array(
      z.object({ id: z.string(), name: z.string(), components: z.array(lean) }),
    ),
    ungroupedComponents: z.array(lean),
    activeIncidents: z.array(incident),
    liveMaintenance: z.array(incident),
    upcomingMaintenance: z.array(incident),
    uptime90d: z.number().nullable(),
    subscribers: z.object({
      total: z.number(),
      active: z.number(),
      unsubscribed: z.number(),
      newLast7d: z.number(),
    }),
    incidentsLast30d: z.number(),
  }),
  responseDescription: "The overview",
  handler: async ({ db }) => {
    const now = Date.now();
    const settings = await readStatusSettings(db);
    const groups = await db
      .select({
        id: statusComponentGroups.id,
        name: statusComponentGroups.name,
      })
      .from(statusComponentGroups)
      .orderBy(
        asc(statusComponentGroups.position),
        asc(statusComponentGroups.id),
      );
    const components = await db
      .select({
        id: statusComponents.id,
        name: statusComponents.name,
        status: statusComponents.status,
        groupId: statusComponents.groupId,
      })
      .from(statusComponents)
      .where(isNull(statusComponents.deletedAt))
      .orderBy(asc(statusComponents.position), asc(statusComponents.id));
    const open = (
      type: "incident" | "maintenance",
      statuses: ("in_progress" | "verifying" | "scheduled")[],
    ) =>
      db
        .select({ id: statusIncidents.id })
        .from(statusIncidents)
        .where(
          and(
            isNull(statusIncidents.deletedAt),
            isNull(statusIncidents.resolvedAt),
            eq(statusIncidents.kind, type),
            statuses.length
              ? inArray(statusIncidents.status, statuses)
              : undefined,
          ),
        );
    const ids = <T>(rows: { id: T }[]) => rows.map((row) => row.id);
    const active = ids(
      await open("incident", [])
        .orderBy(desc(statusIncidents.createdAt), desc(statusIncidents.id))
        .limit(20),
    );
    const running = ids(
      await open("maintenance", ["in_progress", "verifying"])
        .orderBy(desc(statusIncidents.createdAt), desc(statusIncidents.id))
        .limit(20),
    );
    const upcoming = ids(
      await open("maintenance", ["scheduled"])
        .orderBy(
          sql`${statusIncidents.scheduledStartAt} asc nulls last`,
          asc(statusIncidents.id),
        )
        .limit(20),
    );
    const uptime = await uptimeSeriesFor(
      db,
      components.map((c) => c.id),
      90,
    );
    const days = uptime.flatMap((series) => series.days);
    const [subscriptions] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${statusSubscriptions.unsubscribedAt} is null))::int`,
        recent: sql<number>`(count(*) filter (where ${statusSubscriptions.unsubscribedAt} is null and ${statusSubscriptions.createdAt} >= ${new Date(now - 7 * DAY)}))::int`,
      })
      .from(statusSubscriptions);
    const [incidents] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(statusIncidents)
      .where(
        and(
          eq(statusIncidents.kind, "incident"),
          isNull(statusIncidents.deletedAt),
          gte(statusIncidents.startedAt, new Date(now - 30 * DAY)),
        ),
      );
    const leanOf = ({ id, name, status }: (typeof components)[number]) => ({
      id,
      name,
      status,
    });
    return {
      enabled: settings.enabled,
      topLevelStatus: worst(components.map((c) => c.status)),
      groups: groups.map((group) => ({
        ...group,
        components: components
          .filter((c) => c.groupId === group.id)
          .map(leanOf),
      })),
      ungroupedComponents: components.filter((c) => !c.groupId).map(leanOf),
      activeIncidents: await incidentDetails(db, active),
      liveMaintenance: await incidentDetails(db, running),
      upcomingMaintenance: await incidentDetails(db, upcoming),
      uptime90d: days.length
        ? days.reduce((sum, day) => sum + day.uptimePct, 0) / days.length
        : null,
      subscribers: {
        total: subscriptions!.total,
        active: subscriptions!.active,
        unsubscribed: subscriptions!.total - subscriptions!.active,
        newLast7d: subscriptions!.recent,
      },
      incidentsLast30d: incidents!.n,
    };
  },
});

const clearHistory = defineQuillsRoute({
  method: "post",
  path: "/status/history/clear",
  operationId: "clearQuillsStatusHistory",
  summary: "Clear resolved incidents and the uptime history",
  description:
    "Permanently deletes resolved incidents and completed windows with their timelines, and the whole component status log. Components, groups, templates, subscribers and open items stay.",
  action: "manage_settings",
  response: z.object({ incidents: z.number(), events: z.number() }),
  responseDescription: "How many rows were removed",
  event: ({ workspaceId }, result) => ({
    type: "status.history_cleared",
    entityType: "workspace",
    entityId: workspaceId,
    payload: {
      incidents: String(result.incidents),
      events: String(result.events),
    },
  }),
  handler: async ({ db }) => {
    const incidents = await db
      .delete(statusIncidents)
      .where(isNotNull(statusIncidents.resolvedAt));
    const events = await db.delete(statusComponentEvents);
    return { incidents: incidents.rowCount ?? 0, events: events.rowCount ?? 0 };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSummary)
  .openapi(...getUptime)
  .openapi(...clearHistory);
