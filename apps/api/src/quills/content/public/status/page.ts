import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { StatusComponentGroupId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../../../../openapi";
import {
  statusComponentGroups,
  statusIncidents,
} from "../../../../database/quills/schema/status";
import { defineQuillsRoute } from "../../../framework/define-route";
import { uptimeSeriesFor } from "../../status/overview";
import { componentStatus, worst } from "../../status/shared";
import {
  notFound,
  openStatusPage,
  publicIncident,
  publicIncidents,
  visibleComponents,
  visibleIncident,
  type Db,
} from "./visibility";

// The public status page (portal audience, sign-in optional). Each route answers 404 while the
// page is closed to the caller, as a missing incident does, so a closed page reveals nothing.

const DAY = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 14;
const errors = { 404: "Status page or incident not found" };

const component = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: componentStatus,
  showUptime: z.boolean(),
});
const uptimeSeries = z.object({
  componentId: z.string(),
  days: z.array(
    z.object({
      date: z.string(),
      worstStatus: componentStatus,
      uptimePct: z.number(),
    }),
  ),
});

/** Visible incident IDs that match `where`, in order. */
const incidentIds = async (
  db: Db,
  segmentIds: string[],
  where: SQL | undefined,
  orderBy: SQL[],
  limit: number,
) =>
  (
    await db
      .select({ id: statusIncidents.id })
      .from(statusIncidents)
      .where(and(visibleIncident(segmentIds), where))
      .orderBy(...orderBy)
      .limit(limit)
  ).map((row) => row.id);

const newestFirst = [desc(statusIncidents.startedAt), desc(statusIncidents.id)];

const page = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/status",
  operationId: "getQuillsPublicStatusPage",
  summary: "Get the public status page",
  description:
    "Visible components by group, the page status they derive, open incidents and running maintenance, upcoming maintenance, incidents resolved in the last 14 days and 90-day uptime for components that show it. At most 50 open and 50 upcoming items.",
  action: "read",
  response: z.object({
    pageDescription: z.string().nullable(),
    topLevelStatus: componentStatus,
    activeIncidentCount: z.number(),
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        collapsed: z.boolean(),
        components: z.array(component),
      }),
    ),
    ungroupedComponents: z.array(component),
    activeIncidents: z.array(publicIncident),
    upcomingMaintenance: z.array(publicIncident),
    recentIncidents: z.array(
      z.object({ date: z.string(), incidents: z.array(publicIncident) }),
    ),
    recentWindow: z.object({ start: responseTimestamp, days: z.number() }),
    uptime: z.array(uptimeSeries),
  }),
  responseDescription: "The status page",
  errors,
  handler: async ({ db, caller }) => {
    const { page, segmentIds } = await openStatusPage(db, caller);
    const components = await visibleComponents(db, segmentIds);
    const groupIds = [
      ...new Set(components.flatMap((c) => (c.groupId ? [c.groupId] : []))),
    ] as StatusComponentGroupId[];
    const groups = groupIds.length
      ? await db
          .select({
            id: statusComponentGroups.id,
            name: statusComponentGroups.name,
            collapsed: statusComponentGroups.collapsed,
          })
          .from(statusComponentGroups)
          .where(inArray(statusComponentGroups.id, groupIds))
          .orderBy(
            asc(statusComponentGroups.position),
            asc(statusComponentGroups.id),
          )
      : [];
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        RECENT_DAYS * DAY,
    );
    const active = await publicIncidents(
      db,
      await incidentIds(
        db,
        segmentIds,
        or(
          and(
            eq(statusIncidents.kind, "incident"),
            isNull(statusIncidents.resolvedAt),
          ),
          and(
            eq(statusIncidents.kind, "maintenance"),
            inArray(statusIncidents.status, ["in_progress", "verifying"]),
          ),
        ),
        newestFirst,
        50,
      ),
      segmentIds,
    );
    const upcoming = await publicIncidents(
      db,
      await incidentIds(
        db,
        segmentIds,
        and(
          eq(statusIncidents.kind, "maintenance"),
          eq(statusIncidents.status, "scheduled"),
        ),
        [
          sql`${statusIncidents.scheduledStartAt} asc nulls last`,
          asc(statusIncidents.id),
        ],
        50,
      ),
      segmentIds,
    );
    const recent = await publicIncidents(
      db,
      await incidentIds(
        db,
        segmentIds,
        and(
          eq(statusIncidents.kind, "incident"),
          isNotNull(statusIncidents.resolvedAt),
          gte(statusIncidents.startedAt, start),
        ),
        newestFirst,
        100,
      ),
      segmentIds,
    );
    const days = new Map<string, typeof recent>();
    for (const incident of recent) {
      const date = incident.startedAt.toISOString().slice(0, 10);
      days.set(date, [...(days.get(date) ?? []), incident]);
    }
    const view = ({ groupId: _, ...c }: (typeof components)[number]) => c;
    return {
      pageDescription: page.pageDescription,
      topLevelStatus: worst(components.map((c) => c.status)),
      activeIncidentCount: active.filter((i) => i.kind === "incident").length,
      groups: groups
        .map((group) => ({
          ...group,
          components: components
            .filter((c) => c.groupId === group.id)
            .map(view),
        }))
        .filter((group) => group.components.length),
      ungroupedComponents: components.filter((c) => !c.groupId).map(view),
      activeIncidents: active,
      upcomingMaintenance: upcoming,
      recentIncidents: [...days].map(([date, incidents]) => ({
        date,
        incidents,
      })),
      recentWindow: { start, days: RECENT_DAYS },
      uptime: await uptimeSeriesFor(
        db,
        components.filter((c) => c.showUptime).map((c) => c.id),
        90,
      ),
    };
  },
});

const incident = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/status/incidents/{incidentId}",
  operationId: "getQuillsPublicStatusIncident",
  summary: "Get a public incident or maintenance window",
  description:
    "404 alike for a missing incident, one with no visible component and a closed page.",
  action: "read",
  params: z.object({ incidentId: flexibleToTypeIdSchema("status_incident") }),
  response: publicIncident,
  responseDescription: "The incident with its timeline",
  errors,
  handler: async ({ db, caller, params }) => {
    const { segmentIds } = await openStatusPage(db, caller);
    const [found] = await publicIncidents(db, [params.incidentId], segmentIds);
    if (!found) throw notFound("Incident");
    return found;
  },
});

const uptime = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/status/uptime",
  operationId: "getQuillsPublicStatusUptime",
  summary: "Get daily uptime for visible status components",
  description:
    "Components the caller cannot see, deleted or unknown, are left out.",
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
  responseDescription: "One series per visible component",
  errors,
  handler: async ({ db, caller, query }) => {
    const { segmentIds } = await openStatusPage(db, caller);
    const visible = new Set<string>(
      (await visibleComponents(db, segmentIds)).map((c) => c.id),
    );
    return {
      series: await uptimeSeriesFor(
        db,
        query.componentIds.filter((id) => visible.has(id)),
        query.windowDays,
      ),
    };
  },
});

const history = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/status/history",
  operationId: "listQuillsPublicStatusHistory",
  summary: "List resolved incidents and completed maintenance",
  description:
    "Newest first. `before` (the page's `recentWindow.start`) continues after the incidents the page lists; maintenance is not on the page and is always included.",
  action: "read",
  query: z.object({
    cursor: flexibleToTypeIdSchema("status_incident").optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.iso.datetime({ offset: true }).max(64).optional(),
  }),
  response: z.object({
    items: z.array(publicIncident),
    nextCursor: z.string().nullable(),
  }),
  responseDescription: "A page of history",
  errors,
  handler: async ({ db, caller, query }) => {
    const { segmentIds } = await openStatusPage(db, caller);
    // Compared in SQL: a JS Date drops the stored microseconds and would repeat or skip rows.
    const after =
      query.cursor &&
      db
        .select({ startedAt: statusIncidents.startedAt })
        .from(statusIncidents)
        .where(eq(statusIncidents.id, query.cursor));
    const ids = await incidentIds(
      db,
      segmentIds,
      and(
        isNotNull(statusIncidents.resolvedAt),
        query.before
          ? or(
              ne(statusIncidents.kind, "incident"),
              lt(statusIncidents.startedAt, new Date(query.before)),
            )
          : undefined,
        after && query.cursor
          ? or(
              lt(statusIncidents.startedAt, after),
              and(
                eq(statusIncidents.startedAt, after),
                lt(statusIncidents.id, query.cursor),
              ),
            )
          : undefined,
      ),
      newestFirst,
      query.limit + 1,
    );
    const items = await publicIncidents(
      db,
      ids.slice(0, query.limit),
      segmentIds,
    );
    return {
      items,
      nextCursor: ids.length > query.limit ? ids[query.limit - 1]! : null,
    };
  },
});

const feed = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/status/feed",
  operationId: "listQuillsPublicStatusFeed",
  summary: "List the status feed items",
  description:
    "Open incidents and maintenance, then recently resolved items, by latest activity. The framework answers JSON; a reader-facing RSS document is rendered from these items.",
  action: "read",
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    items: z.array(
      publicIncident.extend({
        detailsEditedAt: nullableResponseTimestamp,
        lastActivityAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "Feed items, latest activity first",
  errors,
  handler: async ({ db, caller, query }) => {
    const { segmentIds } = await openStatusPage(db, caller);
    const open = await incidentIds(
      db,
      segmentIds,
      and(
        isNull(statusIncidents.resolvedAt),
        or(
          eq(statusIncidents.kind, "incident"),
          inArray(statusIncidents.status, [
            "scheduled",
            "in_progress",
            "verifying",
          ]),
        ),
      ),
      newestFirst,
      query.limit,
    );
    const resolved = await incidentIds(
      db,
      segmentIds,
      isNotNull(statusIncidents.resolvedAt),
      [desc(statusIncidents.updatedAt), desc(statusIncidents.id)],
      query.limit,
    );
    const items = (
      await publicIncidents(
        db,
        [...new Set([...open, ...resolved])],
        segmentIds,
      )
    ).map((item) => ({
      ...item,
      lastActivityAt: [item.resolvedAt, ...item.updates.map((u) => u.createdAt)]
        .filter((at): at is Date => at !== null)
        .reduce((latest, at) => (at > latest ? at : latest), item.startedAt),
    }));
    return {
      items: items
        .sort((x, y) => +y.lastActivityAt - +x.lastActivityAt)
        .slice(0, query.limit),
    };
  },
});

export default apiRouter()
  .openapi(...page)
  .openapi(...incident)
  .openapi(...uptime)
  .openapi(...history)
  .openapi(...feed);
