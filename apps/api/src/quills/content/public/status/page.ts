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
import { apiRouter, responseTimestamp, z } from "../../../../openapi";
import { settings } from "../../../../database/quills/schema/auth";
import {
  statusComponentGroups,
  statusIncidents,
} from "../../../../database/quills/schema/status";
import { defineQuillsRoute } from "../../../framework/define-route";
import {
  portalUrl,
  publicUrl,
  rssDocument,
} from "../../../portal/feedback/feeds";
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

type FeedItem = z.output<typeof publicIncident> & {
  detailsEditedAt: Date | null;
};
type FeedEntry = Parameters<typeof rssDocument>[0]["items"][number];

/**
 * The source's feed entries of one incident: one per update, and one more for a details edit after
 * the latest update. Each names the status it set and carries the window and services as they are now.
 */
function feedEntries(workspaceId: string, item: FeedItem) {
  const link = portalUrl(workspaceId, `/status/${item.id}`);
  const title = (status: string) =>
    `${item.kind === "maintenance" ? "Maintenance: " : ""}${item.title} (${status.replace(/_/g, " ")})`;
  const context = [
    ...(item.kind === "maintenance" && item.scheduledStartAt
      ? [
          item.scheduledEndAt
            ? `Window: ${item.scheduledStartAt.toUTCString()} to ${item.scheduledEndAt.toUTCString()}`
            : `Starts: ${item.scheduledStartAt.toUTCString()}`,
        ]
      : []),
    ...(item.affectedComponents.length
      ? [`Affected: ${item.affectedComponents.map((c) => c.name).join(", ")}`]
      : []),
  ];
  const entries: FeedEntry[] = item.updates.map((update) => ({
    title: title(update.status),
    description: [update.body.slice(0, 500), ...context].join(" · "),
    publishedAt: update.createdAt,
    link,
    guid: `${link}#${update.id}`,
  }));
  const latest = Math.max(0, ...entries.map((e) => +e.publishedAt));
  if (item.detailsEditedAt && +item.detailsEditedAt > latest)
    entries.push({
      title: title(item.status),
      description: ["Details updated", ...context].join(" · "),
      publishedAt: item.detailsEditedAt,
      link,
      guid: `${link}#edited-${+item.detailsEditedAt}`,
    });
  return entries;
}

const feed = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/status/rss.xml",
  operationId: "listQuillsPublicStatusFeed",
  summary: "Get the status RSS feed",
  description:
    "RSS 2.0: one item per update of open incidents and maintenance and of recently resolved items, newest first, at most `limit` items. The newest item of each open incident always stays. Links point to the portal pages of the web app (/portal/{workspaceId}).",
  action: "read",
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  raw: "application/rss+xml",
  response: z.string(),
  responseDescription: "The RSS document",
  errors,
  handler: async ({ db, caller, query, workspaceId }) => {
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
    const groups = (
      await publicIncidents(
        db,
        [...new Set([...open, ...resolved])],
        segmentIds,
      )
    ).map((item) => ({
      open: item.resolvedAt === null,
      entries: feedEntries(workspaceId, item).sort(
        (x, y) => +y.publishedAt - +x.publishedAt,
      ),
    }));
    // The newest entry of each open item stays; older entries fill the rest of the limit.
    const kept = new Set(
      groups.flatMap((g) => (g.open && g.entries[0] ? [g.entries[0]] : [])),
    );
    for (const entry of groups
      .flatMap((g) => g.entries)
      .filter((e) => !kept.has(e))
      .sort((x, y) => +y.publishedAt - +x.publishedAt)
      .slice(0, Math.max(0, query.limit - kept.size)))
      kept.add(entry);
    const [settingsRow] = await db
      .select({ name: settings.name })
      .from(settings)
      .limit(1);
    const name = settingsRow?.name || "Status";
    return rssDocument({
      title: `${name} Status`,
      description: `Incidents and maintenance for ${name}`,
      link: portalUrl(workspaceId, "/status"),
      self: publicUrl(workspaceId, "/status/rss.xml"),
      items: [...kept].sort((x, y) => +y.publishedAt - +x.publishedAt),
    });
  },
});

export default apiRouter()
  .openapi(...page)
  .openapi(...incident)
  .openapi(...uptime)
  .openapi(...history)
  .openapi(...feed);
