// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isTypeId, type TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { z } from "../../openapi";
import { postStatuses } from "../../database/quills/schema/statuses";
import type { Database } from "../framework/define-route";

// The task sync key of a board's settings (RFC 0003, feature 12, D12). When a Kaneo task that is
// linked to a post moves to a done column, the task-sync job (task-sync-job.ts) sets the post to
// `taskSync.statusOnTaskDone`. The board settings routes (feedback/board-settings.ts) read and write it.

const doneDescription =
  "The post status that a linked post gets when its linked task moves to a done column. Null: no change.";
const plannedDescription =
  "The post status that a linked post gets when its linked task is scheduled into a sprint/cycle. Null: no change.";
const inProgressDescription =
  "The post status that a linked post gets when its linked task moves to an in-progress column. Null: no change.";

export const taskSyncInput = z.object({
  statusOnTaskDone: flexibleToTypeIdSchema("post_status")
    .nullable()
    .openapi({ description: doneDescription }),
  statusOnTaskPlanned: flexibleToTypeIdSchema("post_status")
    .nullable()
    .optional()
    .openapi({ description: plannedDescription }),
  statusOnTaskInProgress: flexibleToTypeIdSchema("post_status")
    .nullable()
    .optional()
    .openapi({ description: inProgressDescription }),
});
export const taskSyncView = z.object({
  statusOnTaskDone: z
    .string()
    .nullable()
    .openapi({ description: doneDescription }),
  statusOnTaskPlanned: z
    .string()
    .nullable()
    .optional()
    .openapi({ description: plannedDescription }),
  statusOnTaskInProgress: z
    .string()
    .nullable()
    .optional()
    .openapi({ description: inProgressDescription }),
});

function readTaskSyncField(
  settings: unknown,
  field: "statusOnTaskDone" | "statusOnTaskPlanned" | "statusOnTaskInProgress",
) {
  const value = (settings as { taskSync?: Record<string, unknown> } | null)
    ?.taskSync?.[field];
  return typeof value === "string" && isTypeId(value, "post_status")
    ? value
    : null;
}

/** The stored status ID, or null when the board has no setting or the value is not a status ID. */
export function statusOnTaskDone(settings: unknown) {
  return readTaskSyncField(settings, "statusOnTaskDone");
}

export function statusOnTaskPlanned(settings: unknown) {
  return readTaskSyncField(settings, "statusOnTaskPlanned");
}

export function statusOnTaskInProgress(settings: unknown) {
  return readTaskSyncField(settings, "statusOnTaskInProgress");
}

export function statusForTaskStage(
  settings: unknown,
  stage: "planned" | "in_progress" | "done",
) {
  if (stage === "done") return statusOnTaskDone(settings);
  if (stage === "in_progress") return statusOnTaskInProgress(settings);
  return statusOnTaskPlanned(settings);
}

/** 404 unless the status is a live post status of the request's workspace. */
export async function checkTaskSyncStatus(
  db: Database,
  statusId: TypeId<"post_status"> | null,
) {
  if (!statusId) return;
  const [status] = await db
    .select({ id: postStatuses.id })
    .from(postStatuses)
    .where(and(eq(postStatuses.id, statusId), isNull(postStatuses.deletedAt)));
  if (!status) throw new HTTPException(404, { message: "Status not found" });
}
