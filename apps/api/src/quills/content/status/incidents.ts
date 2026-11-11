import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { StatusComponentId, StatusIncidentTemplateId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../../openapi";
import {
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
  statusIncidentTemplates,
  statusIncidentUpdates,
  statusSubscriptions,
} from "../../../database/quills/schema/status";
import { defineQuillsRoute } from "../../framework/define-route";
import { someField } from "../../feedback/schemas";
import {
  TERMINAL,
  assertStatusOfKind,
  bad,
  componentStatus,
  conflict,
  deriveImpact,
  holdsComponents,
  impact,
  incident,
  incidentById,
  incidentDetails,
  incidentParams,
  kind,
  lifecycle,
  linkedComponentIds,
  liveComponentIds,
  lockIncident,
  notFound,
  reconcileComponents,
  type Db,
} from "./shared";
import { startMaintenanceWindow } from "./maintenance";

const date = z.iso.datetime({ offset: true }).max(64);
const toDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);
const affected = z
  .array(
    z.object({
      componentId: flexibleToTypeIdSchema("status_component"),
      componentStatus,
    }),
  )
  .min(1)
  .max(50)
  .refine(
    (list) => new Set(list.map((c) => c.componentId)).size === list.length,
    "Each component can appear only once",
  );
const body = z.string().trim().min(1).max(10000);

/** A window must end after it starts. */
function assertWindow(
  start: Date | null | undefined,
  end: Date | null | undefined,
) {
  if (start && end && end <= start)
    throw bad("The scheduled end must be after the scheduled start");
}

/** Every sent component belongs to this workspace (deleted ones included); 404 otherwise. */
async function requireComponents(db: Db, ids: StatusComponentId[]) {
  const found = await db
    .select({ id: statusComponents.id })
    .from(statusComponents)
    .where(inArray(statusComponents.id, ids));
  if (found.length !== new Set(ids).size) throw notFound("Component");
}

async function requireTemplate(
  db: Db,
  id: StatusIncidentTemplateId | undefined,
) {
  if (!id) return;
  const [row] = await db
    .select({ id: statusIncidentTemplates.id })
    .from(statusIncidentTemplates)
    .where(eq(statusIncidentTemplates.id, id))
    .for("key share");
  if (!row) throw notFound("Template");
}

/** Active subscribers who hear about these components: the current pool, not a stored recipient count. */
async function subscriberCount(db: Db, componentIds: string[]) {
  const overlap = componentIds.length
    ? sql`(${statusSubscriptions.scope} = 'components' and ${statusSubscriptions.componentIds} ?| array[${sql.join(
        componentIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])`
    : sql`false`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(statusSubscriptions)
    .where(
      and(
        isNull(statusSubscriptions.unsubscribedAt),
        or(eq(statusSubscriptions.scope, "page"), overlap),
      ),
    );
  return row?.n ?? 0;
}

const listIncidents = defineQuillsRoute({
  method: "get",
  path: "/status/incidents",
  operationId: "listQuillsStatusIncidents",
  summary: "List incidents and maintenance windows",
  description:
    "Newest first. `search` matches the title or any update body. Teammates see components behind segment gates.",
  action: "read",
  query: z.object({
    kind: kind.optional(),
    state: z.enum(["active", "resolved", "all"]).default("all"),
    search: z.string().trim().min(1).max(200).optional(),
    cursor: flexibleToTypeIdSchema("status_incident").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  response: z.object({
    incidents: z.array(incident),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of incidents",
  handler: async ({ db, query }) => {
    const conditions: (SQL | undefined)[] = [
      isNull(statusIncidents.deletedAt),
      query.kind ? eq(statusIncidents.kind, query.kind) : undefined,
      query.state === "active" ? isNull(statusIncidents.resolvedAt) : undefined,
      query.state === "resolved"
        ? isNotNull(statusIncidents.resolvedAt)
        : undefined,
    ];
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        or(
          ilike(statusIncidents.title, pattern),
          sql`exists (select 1 from ${statusIncidentUpdates} where ${statusIncidentUpdates.incidentId} = ${statusIncidents.id} and ${statusIncidentUpdates.body} ilike ${pattern})`,
        ),
      );
    }
    if (query.cursor) {
      // Compared in SQL: a JS Date drops the stored microseconds and would repeat or skip rows.
      const anchor = db
        .select({ createdAt: statusIncidents.createdAt })
        .from(statusIncidents)
        .where(eq(statusIncidents.id, query.cursor));
      conditions.push(
        or(
          lt(statusIncidents.createdAt, anchor),
          and(
            eq(statusIncidents.createdAt, anchor),
            lt(statusIncidents.id, query.cursor),
          ),
        ),
      );
    }
    const rows = await db
      .select({ id: statusIncidents.id })
      .from(statusIncidents)
      .where(and(...conditions))
      .orderBy(desc(statusIncidents.createdAt), desc(statusIncidents.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit).map((row) => row.id);
    const hasMore = rows.length > query.limit;
    return {
      incidents: await incidentDetails(db, page),
      nextCursor: hasMore ? page[page.length - 1]! : null,
      hasMore,
    };
  },
});

const getIncident = defineQuillsRoute({
  method: "get",
  path: "/status/incidents/{incidentId}",
  operationId: "getQuillsStatusIncident",
  summary: "Get an incident or maintenance window",
  action: "read",
  params: incidentParams,
  response: incident.extend({
    notifiedSubscriberCount: z.number().nullable().openapi({
      description:
        "About how many subscribers the publish reached: the current pool for its components",
    }),
  }),
  responseDescription: "The incident with its timeline",
  errors: { 404: "Incident not found" },
  handler: async ({ db, params }) => {
    const found = await incidentById(db, params.incidentId);
    return {
      ...found,
      notifiedSubscriberCount:
        found.notifySubscribers && found.notifiedAt && !found.backfilled
          ? await subscriberCount(
              db,
              found.affectedComponents.map((c) => c.componentId),
            )
          : null,
    };
  },
});

const createIncident = defineQuillsRoute({
  method: "post",
  path: "/status/incidents",
  operationId: "createQuillsStatusIncident",
  summary: "Publish an incident, schedule maintenance or log a past incident",
  description:
    "An incident is public when created. Publishing records status.incident_published for the subscriber mail handler; a backfill records status.incident_created and never notifies. Maintenance automation at the window bounds is stored but needs a scheduler that does not run yet.",
  action: "create",
  body: z.object({
    kind,
    title: z.string().trim().min(1).max(200),
    status: lifecycle,
    impact: impact.optional(),
    impactOverride: z.boolean().optional(),
    affectedComponents: affected,
    body,
    scheduledStartAt: date.nullable().optional(),
    scheduledEndAt: date.nullable().optional(),
    autoStart: z.boolean().optional(),
    autoComplete: z.boolean().optional(),
    backfill: z.object({ startedAt: date, resolvedAt: date }).optional(),
    notifySubscribers: z.boolean().optional(),
    templateId: flexibleToTypeIdSchema("status_tmpl").optional(),
  }),
  response: incident,
  responseDescription: "The created incident",
  errors: { 404: "Component or template not found" },
  event: (_input, result) => ({
    type: result.backfilled
      ? "status.incident_created"
      : "status.incident_published",
    entityType: "status_incident",
    entityId: result.id,
    payload: {
      kind: result.kind,
      // The status at publish: subscriber mail decides from it, not from a later state.
      status: result.status,
      backfilled: String(result.backfilled),
      notify: String(result.notifySubscribers),
    },
  }),
  handler: async ({ db, actor, body: input }) => {
    assertStatusOfKind(input.kind, input.status);
    const start = toDate(input.scheduledStartAt);
    const end = toDate(input.scheduledEndAt);
    assertWindow(start, end);
    const terminal = input.status === TERMINAL[input.kind];
    const backfill = input.backfill && {
      startedAt: new Date(input.backfill.startedAt),
      resolvedAt: new Date(input.backfill.resolvedAt),
    };
    if (backfill && !terminal)
      throw bad(
        `A past ${input.kind} is logged as ${TERMINAL[input.kind]}. Use that status.`,
      );
    if (backfill && backfill.resolvedAt <= backfill.startedAt)
      throw bad("A past incident must be resolved after it started");
    const ids = input.affectedComponents.map((c) => c.componentId);
    const live = await liveComponentIds(db, ids);
    if (ids.some((id) => !live.has(id))) throw notFound("Component");
    await requireTemplate(db, input.templateId);

    const now = new Date();
    const resolvedAt = backfill?.resolvedAt ?? (terminal ? now : null);
    // A window that has not run keeps its planned start in started_at, never after it completed.
    const planned =
      input.kind === "maintenance" && (input.status === "scheduled" || terminal)
        ? start
        : null;
    const startedAt =
      backfill?.startedAt ??
      (planned && (!resolvedAt || planned <= resolvedAt) ? planned : now);
    const [created] = await db
      .insert(statusIncidents)
      .values({
        kind: input.kind,
        title: input.title,
        status: input.status,
        impact:
          input.kind === "maintenance"
            ? "maintenance"
            : input.impactOverride
              ? (input.impact ?? "none")
              : deriveImpact(
                  input.affectedComponents.map((c) => c.componentStatus),
                ),
        impactOverride:
          input.kind === "incident" && Boolean(input.impactOverride),
        scheduledStartAt: start ?? null,
        scheduledEndAt: end ?? null,
        autoStart: input.autoStart ?? true,
        autoComplete: input.autoComplete ?? true,
        startedAt,
        resolvedAt,
        backfilled: Boolean(backfill),
        // The publish is claimed now: the event below drives the subscriber mail.
        notifySubscribers: !backfill && (input.notifySubscribers ?? true),
        notifiedAt: backfill ? null : now,
        createdBy: actor.principalId,
      })
      .returning({ id: statusIncidents.id });
    const id = created!.id;
    await db.insert(statusIncidentComponents).values(
      input.affectedComponents.map((c) => ({
        incidentId: id,
        componentId: c.componentId,
        componentStatus: c.componentStatus,
      })),
    );
    const holds = holdsComponents(input.kind, input.status);
    await db.insert(statusIncidentUpdates).values({
      incidentId: id,
      status: input.status,
      body: input.body,
      createdBy: actor.principalId,
      templateId: input.templateId ?? null,
      // A past incident's summary belongs to its resolution; a window created running is dated at its start.
      ...(backfill
        ? { createdAt: backfill.resolvedAt }
        : input.kind === "maintenance" && holds
          ? { createdAt: startedAt }
          : {}),
    });
    if (!backfill && holds) await reconcileComponents(db, ids, input.kind, id);
    return incidentById(db, id);
  },
});

const updateIncident = defineQuillsRoute({
  method: "patch",
  path: "/status/incidents/{incidentId}",
  operationId: "updateQuillsStatusIncident",
  summary: "Edit an incident's title, impact, window, automation or components",
  description:
    "Posts no timeline update. A component list replaces the live links; links to deleted components stay as history. Status changes go through updates.",
  action: "update",
  params: incidentParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      impact: impact.optional(),
      impactOverride: z.boolean().optional(),
      affectedComponents: affected.optional(),
      scheduledStartAt: date.nullable().optional(),
      scheduledEndAt: date.nullable().optional(),
      autoStart: z.boolean().optional(),
      autoComplete: z.boolean().optional(),
    })
    .refine(someField, "Change at least one field"),
  response: incident,
  responseDescription: "The updated incident",
  errors: { 404: "Incident or component not found" },
  event: (_input, result) => ({
    type: "status.incident_updated",
    entityType: "status_incident",
    entityId: result.id,
  }),
  handler: async ({ db, params: { incidentId }, body: input }) => {
    const existing = await lockIncident(db, incidentId);
    const start = toDate(input.scheduledStartAt);
    const end = toDate(input.scheduledEndAt);
    if (start !== undefined || end !== undefined)
      assertWindow(
        start === undefined ? existing.scheduledStartAt : start,
        end === undefined ? existing.scheduledEndAt : end,
      );
    const same = (a: Date | null, b: Date | null) =>
      (a?.getTime() ?? null) === (b?.getTime() ?? null);
    // A change a status feed reader would hear about: title, window or components.
    let detailsChanged =
      (input.title !== undefined && input.title !== existing.title) ||
      (start !== undefined && !same(start, existing.scheduledStartAt)) ||
      (end !== undefined && !same(end, existing.scheduledEndAt));
    const impactOverride =
      input.impactOverride === undefined
        ? existing.impactOverride
        : existing.kind === "incident" && input.impactOverride;

    let next = input.affectedComponents;
    let replaced: StatusComponentId[] = [];
    if (next) {
      await requireComponents(
        db,
        next.map((c) => c.componentId),
      );
      const previous = await db
        .select({
          componentId: statusIncidentComponents.componentId,
          componentStatus: statusIncidentComponents.componentStatus,
        })
        .from(statusIncidentComponents)
        .where(eq(statusIncidentComponents.incidentId, incidentId));
      const live = await liveComponentIds(db, [
        ...previous.map((link) => link.componentId),
        ...next.map((c) => c.componentId),
      ]);
      // A stale editor that sends a deleted component back does not relink it.
      next = next.filter((c) => live.has(c.componentId));
      if (!next.length)
        throw bad("Every component sent has been deleted. Choose them again.");
      replaced = previous
        .map((link) => link.componentId)
        .filter((id) => live.has(id));
      // Only components every page viewer can see count as a public change.
      const everyone = new Set(
        (
          await db
            .select({
              id: statusComponents.id,
              segmentIds: statusComponents.segmentIds,
            })
            .from(statusComponents)
            .where(
              inArray(statusComponents.id, [...live] as StatusComponentId[]),
            )
        )
          .filter((c) => c.segmentIds.length === 0)
          .map((c) => c.id as string),
      );
      const before = new Map(
        previous
          .filter((link) => everyone.has(link.componentId))
          .map((link) => [link.componentId as string, link.componentStatus]),
      );
      const after = next.filter((c) => everyone.has(c.componentId));
      detailsChanged ||=
        after.length !== before.size ||
        after.some((c) => before.get(c.componentId) !== c.componentStatus);
    }
    await db
      .update(statusIncidents)
      .set({
        title: input.title,
        scheduledStartAt: start,
        scheduledEndAt: end,
        autoStart: input.autoStart,
        autoComplete: input.autoComplete,
        impactOverride:
          input.impactOverride === undefined ? undefined : impactOverride,
        impact:
          existing.kind !== "incident"
            ? undefined
            : impactOverride && input.impact !== undefined
              ? input.impact
              : !impactOverride && next
                ? deriveImpact(next.map((c) => c.componentStatus))
                : undefined,
        // A window that has not started keeps its planned start in started_at.
        startedAt:
          existing.kind === "maintenance" &&
          existing.status === "scheduled" &&
          start
            ? start
            : undefined,
        // The database clock dates updates too, so "edited after the latest update" never turns on skew.
        detailsEditedAt: detailsChanged ? sql`now()` : undefined,
        updatedAt: new Date(),
      })
      .where(eq(statusIncidents.id, incidentId));
    if (next) {
      if (replaced.length)
        await db
          .delete(statusIncidentComponents)
          .where(
            and(
              eq(statusIncidentComponents.incidentId, incidentId),
              inArray(statusIncidentComponents.componentId, replaced),
            ),
          );
      await db.insert(statusIncidentComponents).values(
        next.map((c) => ({
          incidentId,
          componentId: c.componentId,
          componentStatus: c.componentStatus,
        })),
      );
      if (holdsComponents(existing.kind, existing.status))
        await reconcileComponents(
          db,
          [...replaced, ...next.map((c) => c.componentId)],
          existing.kind,
          incidentId,
        );
    }
    return incidentById(db, incidentId);
  },
});

const postUpdate = defineQuillsRoute({
  method: "post",
  path: "/status/incidents/{incidentId}/updates",
  operationId: "postQuillsStatusIncidentUpdate",
  summary: "Post a timeline update: progress, resolve or reopen",
  description:
    "A terminal status resolves the incident (or completes the window) and restores its components unless `skipRestore` is set. A move back reopens it. Starting a scheduled window applies its component statuses.",
  action: "update",
  params: incidentParams,
  body: z.object({
    status: lifecycle,
    body,
    skipRestore: z.boolean().optional(),
    templateId: flexibleToTypeIdSchema("status_tmpl").optional(),
  }),
  response: incident.extend({ previousStatus: lifecycle }),
  responseDescription: "The incident with the new update",
  errors: { 404: "Incident or template not found" },
  event: (_input, result) => ({
    type:
      result.status === TERMINAL[result.kind] &&
      result.previousStatus !== result.status
        ? "status.incident_resolved"
        : "status.incident_update_posted",
    entityType: "status_incident",
    entityId: result.id,
    payload: {
      kind: result.kind,
      status: result.status,
      previousStatus: result.previousStatus,
    },
  }),
  handler: async ({ db, actor, params: { incidentId }, body: input }) => {
    const existing = await lockIncident(db, incidentId);
    const kindOf = existing.kind;
    assertStatusOfKind(kindOf, input.status);
    await requireTemplate(db, input.templateId);
    const wasTerminal = existing.status === TERMINAL[kindOf];
    const becomesTerminal = input.status === TERMINAL[kindOf];
    if (existing.backfilled && !becomesTerminal)
      throw conflict(`A logged past ${kindOf} cannot be reopened`);
    const heldBefore = holdsComponents(kindOf, existing.status);
    const starts =
      kindOf === "maintenance" &&
      existing.status === "scheduled" &&
      holdsComponents(kindOf, input.status);
    const unschedules =
      kindOf === "maintenance" &&
      existing.status !== "scheduled" &&
      input.status === "scheduled";
    const reopens = wasTerminal && !becomesTerminal;
    const now = new Date();
    const pastStart =
      existing.scheduledStartAt && existing.scheduledStartAt <= now;
    const pastEnd = existing.scheduledEndAt && existing.scheduledEndAt <= now;
    // A window's first real start dates started_at, also when it begins after an early completion.
    const firstStart =
      kindOf === "maintenance" &&
      holdsComponents(kindOf, input.status) &&
      !(
        await db
          .select({ id: statusIncidentUpdates.id })
          .from(statusIncidentUpdates)
          .where(
            and(
              eq(statusIncidentUpdates.incidentId, incidentId),
              inArray(statusIncidentUpdates.status, [
                "in_progress",
                "verifying",
              ]),
            ),
          )
          .limit(1)
      ).length;
    await db.insert(statusIncidentUpdates).values({
      incidentId,
      status: input.status,
      body: input.body,
      createdBy: actor.principalId,
      templateId: input.templateId ?? null,
      ...(starts ? { createdAt: now } : {}),
    });
    await db
      .update(statusIncidents)
      .set({
        status: input.status,
        updatedAt: now,
        resolvedAt:
          becomesTerminal && (!wasTerminal || !existing.resolvedAt)
            ? now
            : reopens
              ? null
              : undefined,
        startedAt:
          starts || firstStart
            ? now
            : unschedules && existing.scheduledStartAt
              ? existing.scheduledStartAt
              : kindOf === "maintenance" &&
                  existing.status === "scheduled" &&
                  becomesTerminal &&
                  existing.startedAt > now
                ? now
                : undefined,
        // A window moved back across a bound that has passed would be moved forward again by a scheduler.
        autoComplete:
          kindOf === "maintenance" &&
          (reopens || unschedules) &&
          existing.autoComplete &&
          pastEnd
            ? false
            : undefined,
        autoStart:
          unschedules && existing.autoStart && pastStart ? false : undefined,
      })
      .where(eq(statusIncidents.id, incidentId));
    const recompute = becomesTerminal
      ? heldBefore && !input.skipRestore
      : heldBefore !== holdsComponents(kindOf, input.status);
    if (recompute)
      await reconcileComponents(
        db,
        await linkedComponentIds(db, incidentId),
        kindOf,
        incidentId,
      );
    return {
      ...(await incidentById(db, incidentId)),
      previousStatus: existing.status,
    };
  },
});

const startMaintenance = defineQuillsRoute({
  method: "post",
  path: "/status/incidents/{incidentId}/start",
  operationId: "startQuillsStatusMaintenance",
  summary: "Start a scheduled maintenance window now",
  description:
    "Applies the window's component statuses and posts the start update. The planned window stays as planned.",
  action: "update",
  params: incidentParams,
  response: incident,
  responseDescription: "The started window",
  errors: {
    404: "Incident not found",
    409: "Not a scheduled maintenance window",
  },
  event: (_input, result) => ({
    type: "status.maintenance_started",
    entityType: "status_incident",
    entityId: result.id,
  }),
  handler: async ({ db, actor, params: { incidentId } }) => {
    if (!(await startMaintenanceWindow(db, incidentId, actor.principalId)))
      throw conflict("Only a scheduled maintenance window can be started");
    return incidentById(db, incidentId);
  },
});

const deleteIncident = defineQuillsRoute({
  method: "delete",
  path: "/status/incidents/{incidentId}",
  operationId: "deleteQuillsStatusIncident",
  summary: "Delete an incident or maintenance window",
  description:
    "A soft delete. Components it held return to the status that the remaining open items set.",
  action: "delete",
  params: incidentParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted incident",
  errors: { 404: "Incident not found" },
  event: ({ params }) => ({
    type: "status.incident_deleted",
    entityType: "status_incident",
    entityId: params.incidentId,
  }),
  handler: async ({ db, params: { incidentId } }) => {
    const existing = await lockIncident(db, incidentId);
    await db
      .update(statusIncidents)
      .set({ deletedAt: new Date() })
      .where(eq(statusIncidents.id, incidentId));
    if (holdsComponents(existing.kind, existing.status))
      await reconcileComponents(
        db,
        await linkedComponentIds(db, incidentId),
        existing.kind,
        incidentId,
      );
    return { id: incidentId };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listIncidents)
  .openapi(...getIncident)
  .openapi(...createIncident)
  .openapi(...updateIncident)
  .openapi(...postUpdate)
  .openapi(...startMaintenance)
  .openapi(...deleteIncident);
