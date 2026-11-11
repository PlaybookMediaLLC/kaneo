// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, asc, isNull, sql } from "drizzle-orm";
import type { StatusIncidentId } from "@kaneo/ids";
import {
  nullableResponseTimestamp,
  responseTimestamp,
  z,
} from "../../../../openapi";
import { settings } from "../../../../database/quills/schema/auth";
import {
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
} from "../../../../database/quills/schema/status";
import {
  evaluatePortalAccess,
  type QuillsCaller,
} from "../../../framework/audience";
import { parseJson } from "../../../settings/area";
import { resolveFlags } from "../../../settings/labs";
import { readStatusSettings } from "../../status/settings";
import {
  componentStatus,
  deriveImpact,
  impact,
  incidentDetails,
  kind,
  lifecycle,
} from "../../status/shared";
import {
  notFound,
  segmentGate,
  viewerSegments,
  type Db,
} from "../help-center/visibility";

// What a visitor may read on the status page. The page is open when the statusPage module and
// the page's own publish switch are on, the private-portal gate passes and the page audience
// (public, signed in, or segment members) admits the caller. A component gated to segments is
// visible only to their members. An incident is visible only through a visible live component,
// and its impact never reveals the severity of a component the visitor cannot see.

export { notFound, type Db };

export async function openStatusPage(db: Db, caller: QuillsCaller) {
  const [row] = await db
    .select({ featureFlags: settings.featureFlags })
    .from(settings);
  const page = await readStatusSettings(db);
  if (
    !resolveFlags(parseJson(row?.featureFlags ?? null)).statusPage ||
    !page.enabled ||
    !(await evaluatePortalAccess(db, caller)).granted
  )
    throw notFound("Status page");
  const segmentIds = await viewerSegments(db, caller.principalId);
  const admitted =
    page.audience === "public" ||
    (page.audience === "authenticated" && caller.account !== null) ||
    (page.audience === "segments" &&
      segmentIds.some((id) => page.allowedSegmentIds.includes(id)));
  if (!admitted) throw notFound("Status page");
  return { page, segmentIds };
}

const allows = (gate: readonly string[], segmentIds: string[]) =>
  !gate.length || gate.some((id) => segmentIds.includes(id));

/** Live components the viewer may see, in page order. */
export const visibleComponents = (db: Db, segmentIds: string[]) =>
  db
    .select({
      id: statusComponents.id,
      name: statusComponents.name,
      description: statusComponents.description,
      status: statusComponents.status,
      showUptime: statusComponents.showUptime,
      groupId: statusComponents.groupId,
    })
    .from(statusComponents)
    .where(
      and(
        isNull(statusComponents.deletedAt),
        segmentGate(statusComponents.segmentIds, segmentIds),
      ),
    )
    .orderBy(asc(statusComponents.position), asc(statusComponents.id));

/** A live incident that links at least one live component the viewer may see. */
export const visibleIncident = (segmentIds: string[]) =>
  and(
    isNull(statusIncidents.deletedAt),
    sql`exists (select 1 from ${statusIncidentComponents} join ${statusComponents}
      on ${statusComponents.id} = ${statusIncidentComponents.componentId}
      where ${statusIncidentComponents.incidentId} = ${statusIncidents.id}
      and ${statusComponents.deletedAt} is null
      and ${segmentGate(statusComponents.segmentIds, segmentIds)})`,
  );

export const publicIncident = z
  .object({
    id: z.string(),
    kind,
    title: z.string(),
    status: lifecycle,
    impact,
    scheduledStartAt: nullableResponseTimestamp,
    scheduledEndAt: nullableResponseTimestamp,
    startedAt: responseTimestamp,
    resolvedAt: nullableResponseTimestamp,
    affectedComponents: z.array(
      z.object({ id: z.string(), name: z.string(), componentStatus }),
    ),
    updates: z.array(
      z.object({
        id: z.string(),
        status: lifecycle,
        body: z.string(),
        createdAt: responseTimestamp,
      }),
    ),
  })
  .openapi("QuillsPublicStatusIncident");

const RANK = ["none", "minor", "major", "critical"];

/** The source's viewer impact: with a component hidden, the visible ones may lower it, never raise it. */
export function viewerImpact(
  stored: z.output<typeof impact>,
  visible: Parameters<typeof deriveImpact>[0],
  someHidden: boolean,
) {
  if (!someHidden || stored === "maintenance") return stored;
  const derived = deriveImpact(visible);
  return RANK.indexOf(derived) < RANK.indexOf(stored) ? derived : stored;
}

/** The viewer's projection of the incidents among `ids`, in order; an incident with no visible component is dropped. */
export async function publicIncidents(
  db: Db,
  ids: StatusIncidentId[],
  segmentIds: string[],
) {
  return (await incidentDetails(db, ids)).flatMap((row) => {
    const visible = row.affectedComponents.filter((link) =>
      allows(link.segmentIds, segmentIds),
    );
    if (!visible.length) return [];
    return [
      {
        id: row.id as string,
        kind: row.kind,
        title: row.title,
        status: row.status,
        impact: viewerImpact(
          row.impact,
          visible.map((link) => link.componentStatus),
          visible.length < row.affectedComponents.length,
        ),
        scheduledStartAt: row.scheduledStartAt,
        scheduledEndAt: row.scheduledEndAt,
        startedAt: row.startedAt,
        resolvedAt: row.resolvedAt,
        detailsEditedAt: row.detailsEditedAt,
        affectedComponents: visible.map((link) => ({
          id: link.componentId as string,
          name: link.name,
          componentStatus: link.componentStatus,
        })),
        updates: row.updates.map((update) => ({
          id: update.id as string,
          status: update.status,
          body: update.body,
          createdAt: update.createdAt,
        })),
      },
    ];
  });
}
