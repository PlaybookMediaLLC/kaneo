// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { StatusComponentId, StatusIncidentId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../../../openapi";
import {
  statusComponentEvents,
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
  statusIncidentUpdates,
  type StatusComponentEventSource,
  type StatusComponentStatus,
} from "../../../database/quills/schema/status";
import { bad, notFound, type Db } from "../help-center/shared";

export { bad, conflict, notFound, type Db } from "../help-center/shared";

/** Least to most severe. */
export const SEVERITY = [
  "operational",
  "under_maintenance",
  "degraded_performance",
  "partial_outage",
  "major_outage",
] as const satisfies readonly StatusComponentStatus[];
export const componentStatus = z.enum(SEVERITY);
export const kind = z.enum(["incident", "maintenance"]);
export const impact = z.enum([
  "none",
  "minor",
  "major",
  "critical",
  "maintenance",
]);
export const lifecycle = z.enum([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
  "scheduled",
  "in_progress",
  "verifying",
  "completed",
]);
type Kind = z.output<typeof kind>;
export const STATUSES: Record<Kind, readonly string[]> = {
  incident: ["investigating", "identified", "monitoring", "resolved"],
  maintenance: ["scheduled", "in_progress", "verifying", "completed"],
};
export const TERMINAL: Record<Kind, string> = {
  incident: "resolved",
  maintenance: "completed",
};

/** A maintenance status on an incident (or the reverse) would never match a lifecycle check. */
export function assertStatusOfKind(value: Kind, status: string) {
  if (!STATUSES[value].includes(status))
    throw bad(
      `"${status}" is not ${value === "incident" ? "an incident" : "a maintenance"} status. Use one of: ${STATUSES[value].join(", ")}.`,
    );
}

export const worst = (statuses: readonly StatusComponentStatus[]) =>
  statuses.reduce<StatusComponentStatus>(
    (top, status) =>
      SEVERITY.indexOf(status) > SEVERITY.indexOf(top) ? status : top,
    "operational",
  );

/** The source's impact derivation: maintenance never raises an incident's impact. */
export function deriveImpact(statuses: readonly StatusComponentStatus[]) {
  const rank = {
    operational: 0,
    under_maintenance: 0,
    degraded_performance: 1,
    partial_outage: 2,
    major_outage: 3,
  };
  const top = Math.max(0, ...statuses.map((status) => rank[status]));
  return (["none", "minor", "major", "critical"] as const)[top]!;
}

/** Whether a row in this state holds its components at their affected status. */
export const holdsComponents = (value: string, status: string) =>
  value === "incident"
    ? status !== "resolved"
    : status === "in_progress" || status === "verifying";

/** The live components among `ids`. */
export async function liveComponentIds(db: Db, ids: readonly string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({ id: statusComponents.id })
    .from(statusComponents)
    .where(
      and(
        inArray(statusComponents.id, ids as StatusComponentId[]),
        isNull(statusComponents.deletedAt),
      ),
    );
  return new Set<string>(rows.map((row) => row.id));
}

/** Sets a component's live status and appends the event row that uptime derives from. A same status is a no-op. */
export async function writeComponentStatus(
  db: Db,
  component: { id: StatusComponentId; status: StatusComponentStatus },
  status: StatusComponentStatus,
  source: StatusComponentEventSource,
  incidentId: StatusIncidentId | null,
) {
  if (component.status === status) return false;
  await db
    .update(statusComponents)
    .set({ status, updatedAt: new Date() })
    .where(eq(statusComponents.id, component.id));
  await db
    .insert(statusComponentEvents)
    .values({ componentId: component.id, status, source, incidentId });
  return true;
}

/**
 * Recomputes each component from every open incident and running window that holds it.
 * Components lock in id order after the incident row, so two lifecycle writes cannot deadlock.
 * A deleted component is skipped: an incident that still links it stays resolvable.
 */
export async function reconcileComponents(
  db: Db,
  componentIds: Iterable<string>,
  source: StatusComponentEventSource,
  incidentId: StatusIncidentId,
) {
  for (const id of [...new Set(componentIds)].sort()) {
    const [component] = await db
      .select({ id: statusComponents.id, status: statusComponents.status })
      .from(statusComponents)
      .where(
        and(
          eq(statusComponents.id, id as StatusComponentId),
          isNull(statusComponents.deletedAt),
        ),
      )
      .for("no key update");
    if (!component) continue;
    const held = await db
      .select({ status: statusIncidentComponents.componentStatus })
      .from(statusIncidentComponents)
      .innerJoin(
        statusIncidents,
        eq(statusIncidents.id, statusIncidentComponents.incidentId),
      )
      .where(
        and(
          eq(statusIncidentComponents.componentId, component.id),
          isNull(statusIncidents.deletedAt),
          sql`((${statusIncidents.kind} = 'incident' and ${statusIncidents.status} <> 'resolved')
            or (${statusIncidents.kind} = 'maintenance' and ${statusIncidents.status} in ('in_progress', 'verifying')))`,
        ),
      );
    await writeComponentStatus(
      db,
      component,
      worst(held.map((row) => row.status)),
      source,
      incidentId,
    );
  }
}

/** The component IDs an incident links, deleted components included. */
export const linkedComponentIds = async (db: Db, id: StatusIncidentId) =>
  (
    await db
      .select({ componentId: statusIncidentComponents.componentId })
      .from(statusIncidentComponents)
      .where(eq(statusIncidentComponents.incidentId, id))
  ).map((row) => row.componentId);

/** Locks a live incident for the lifecycle write, before any component, and returns it as it stands. */
export async function lockIncident(db: Db, id: StatusIncidentId) {
  const [row] = await db
    .select()
    .from(statusIncidents)
    .where(and(eq(statusIncidents.id, id), isNull(statusIncidents.deletedAt)))
    .for("no key update");
  if (!row) throw notFound("Incident");
  return row;
}

export const incident = z
  .object({
    id: z.string(),
    kind,
    title: z.string(),
    status: lifecycle,
    impact,
    impactOverride: z.boolean(),
    scheduledStartAt: nullableResponseTimestamp,
    scheduledEndAt: nullableResponseTimestamp,
    autoStart: z.boolean(),
    autoComplete: z.boolean(),
    startedAt: responseTimestamp,
    resolvedAt: nullableResponseTimestamp,
    backfilled: z.boolean(),
    notifiedAt: nullableResponseTimestamp,
    notifySubscribers: z.boolean(),
    detailsEditedAt: nullableResponseTimestamp,
    createdBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    affectedComponents: z.array(
      z.object({
        componentId: z.string(),
        componentStatus,
        name: z.string(),
        segmentIds: z.array(z.string()),
      }),
    ),
    updates: z.array(
      z.object({
        id: z.string(),
        status: lifecycle,
        body: z.string(),
        createdBy: z.string().nullable(),
        templateId: z.string().nullable(),
        createdAt: responseTimestamp,
      }),
    ),
  })
  .openapi("QuillsStatusIncident");
export const incidentParams = z.object({
  incidentId: flexibleToTypeIdSchema("status_incident"),
});

/** Incidents with their live components and full timeline, in the order of `ids`. */
export async function incidentDetails(db: Db, ids: StatusIncidentId[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: statusIncidents.id,
      kind: statusIncidents.kind,
      title: statusIncidents.title,
      status: statusIncidents.status,
      impact: statusIncidents.impact,
      impactOverride: statusIncidents.impactOverride,
      scheduledStartAt: statusIncidents.scheduledStartAt,
      scheduledEndAt: statusIncidents.scheduledEndAt,
      autoStart: statusIncidents.autoStart,
      autoComplete: statusIncidents.autoComplete,
      startedAt: statusIncidents.startedAt,
      resolvedAt: statusIncidents.resolvedAt,
      backfilled: statusIncidents.backfilled,
      notifiedAt: statusIncidents.notifiedAt,
      notifySubscribers: statusIncidents.notifySubscribers,
      detailsEditedAt: statusIncidents.detailsEditedAt,
      createdBy: statusIncidents.createdBy,
      createdAt: statusIncidents.createdAt,
      updatedAt: statusIncidents.updatedAt,
    })
    .from(statusIncidents)
    .where(
      and(inArray(statusIncidents.id, ids), isNull(statusIncidents.deletedAt)),
    );
  // A deleted component is off the page; leaving it out keeps an editor from resubmitting it.
  const links = await db
    .select({
      incidentId: statusIncidentComponents.incidentId,
      componentId: statusIncidentComponents.componentId,
      componentStatus: statusIncidentComponents.componentStatus,
      name: statusComponents.name,
      segmentIds: statusComponents.segmentIds,
    })
    .from(statusIncidentComponents)
    .innerJoin(
      statusComponents,
      eq(statusComponents.id, statusIncidentComponents.componentId),
    )
    .where(
      and(
        inArray(statusIncidentComponents.incidentId, ids),
        isNull(statusComponents.deletedAt),
      ),
    )
    .orderBy(asc(statusComponents.position), asc(statusComponents.id));
  const updates = await db
    .select({
      incidentId: statusIncidentUpdates.incidentId,
      id: statusIncidentUpdates.id,
      status: statusIncidentUpdates.status,
      body: statusIncidentUpdates.body,
      createdBy: statusIncidentUpdates.createdBy,
      templateId: statusIncidentUpdates.templateId,
      createdAt: statusIncidentUpdates.createdAt,
    })
    .from(statusIncidentUpdates)
    .where(inArray(statusIncidentUpdates.incidentId, ids))
    .orderBy(
      asc(statusIncidentUpdates.createdAt),
      asc(statusIncidentUpdates.id),
    );
  return ids.flatMap((id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return [];
    return [
      {
        ...row,
        affectedComponents: links
          .filter((link) => link.incidentId === id)
          .map(({ incidentId: _, ...link }) => link),
        updates: updates
          .filter((update) => update.incidentId === id)
          .map(({ incidentId: _, ...update }) => update),
      },
    ];
  });
}

export async function incidentById(db: Db, id: StatusIncidentId) {
  const [found] = await incidentDetails(db, [id]);
  if (!found) throw notFound("Incident");
  return found;
}
