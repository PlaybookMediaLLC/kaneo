// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { eq, sql } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import {
  statusIncidents,
  statusIncidentUpdates,
} from "../../../database/quills/schema/status";
import {
  holdsComponents,
  linkedComponentIds,
  lockIncident,
  reconcileComponents,
  type Db,
} from "./shared";

// Maintenance window bounds, shared by the start route and the scheduled sweep (jobs/handlers/sweeps.ts).

type IncidentId = TypeId<"status_incident">;
type Author = TypeId<"principal"> | null;

/** Starts a scheduled window: applies its component statuses and posts the start update. False when it is not one. */
export async function startMaintenanceWindow(
  db: Db,
  incidentId: IncidentId,
  createdBy: Author,
) {
  const existing = await lockIncident(db, incidentId);
  if (existing.kind !== "maintenance" || existing.status !== "scheduled")
    return false;
  const now = new Date();
  await db
    .update(statusIncidents)
    .set({ status: "in_progress", startedAt: now, updatedAt: now })
    .where(eq(statusIncidents.id, incidentId));
  await db.insert(statusIncidentUpdates).values({
    incidentId,
    status: "in_progress",
    body: "This scheduled maintenance is now in progress.",
    createdBy,
    createdAt: now,
  });
  await reconcileComponents(
    db,
    await linkedComponentIds(db, incidentId),
    "maintenance",
    incidentId,
  );
  return true;
}

/**
 * Completes a window at its planned end, as a terminal update would, and restores the components
 * it held. A window whose start was missed held nothing and leaves them alone. Returns the status
 * it left, or false when the window is already complete.
 */
export async function completeMaintenanceWindow(
  db: Db,
  incidentId: IncidentId,
) {
  const existing = await lockIncident(db, incidentId);
  if (existing.kind !== "maintenance" || existing.status === "completed")
    return false;
  await db.insert(statusIncidentUpdates).values({
    incidentId,
    status: "completed",
    body: "This scheduled maintenance has been completed.",
    createdBy: null,
  });
  await db
    .update(statusIncidents)
    .set({
      status: "completed",
      resolvedAt: sql`coalesce(${statusIncidents.resolvedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(statusIncidents.id, incidentId));
  if (holdsComponents(existing.kind, existing.status))
    await reconcileComponents(
      db,
      await linkedComponentIds(db, incidentId),
      "maintenance",
      incidentId,
    );
  return existing.status;
}
