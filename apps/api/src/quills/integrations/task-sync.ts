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

const description =
  "The post status that a linked post gets when its Kaneo task moves to a done column. Null: no change.";
export const taskSyncInput = z.object({
  statusOnTaskDone: flexibleToTypeIdSchema("post_status")
    .nullable()
    .openapi({ description }),
});
export const taskSyncView = z.object({
  statusOnTaskDone: z.string().nullable().openapi({ description }),
});

/** The stored status ID, or null when the board has no setting or the value is not a status ID. */
export function statusOnTaskDone(settings: unknown) {
  const value = (
    settings as { taskSync?: { statusOnTaskDone?: unknown } } | null
  )?.taskSync?.statusOnTaskDone;
  return typeof value === "string" && isTypeId(value, "post_status")
    ? value
    : null;
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
