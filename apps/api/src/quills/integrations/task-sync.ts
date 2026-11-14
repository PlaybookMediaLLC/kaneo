import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isTypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute } from "../framework/define-route";
import { findBoard, loadProjects } from "../feedback/visibility";

// The task sync setting of a board (RFC 0003, feature 12, D12). When a Kaneo task that is linked
// to a post moves to a done column, the task-sync job (task-sync-job.ts) sets the post to this
// status. The setting is the `taskSync` key of boards.settings; a write keeps the other keys.

/** The stored status ID, or null when the board has no setting or the value is not a status ID. */
export function statusOnTaskDone(settings: unknown) {
  const value = (
    settings as { taskSync?: { statusOnTaskDone?: unknown } } | null
  )?.taskSync?.statusOnTaskDone;
  return typeof value === "string" && isTypeId(value, "post_status")
    ? value
    : null;
}

const boardParams = z.object({ boardId: flexibleToTypeIdSchema("board") });
const taskSync = z.object({
  boardId: z.string(),
  statusOnTaskDone: z.string().nullable().openapi({
    description:
      "The post status that a linked post gets when its Kaneo task moves to a done column. Null: no change.",
  }),
});
const errors = { 404: "Board or status not found" };

const getTaskSync = defineQuillsRoute({
  method: "get",
  path: "/boards/{boardId}/task-sync",
  operationId: "getQuillsBoardTaskSync",
  summary: "Get a board's task sync setting",
  action: "read",
  params: boardParams,
  response: taskSync,
  responseDescription: "Task sync setting",
  errors,
  load: loadProjects,
  handler: async ({ db, params, loaded: projects }) => {
    const board = await findBoard(db, params.boardId, projects);
    const [row] = await db
      .select({ settings: boards.settings })
      .from(boards)
      .where(eq(boards.id, board.id));
    return {
      boardId: board.id,
      statusOnTaskDone: statusOnTaskDone(row!.settings),
    };
  },
});

const setTaskSync = defineQuillsRoute({
  method: "put",
  path: "/boards/{boardId}/task-sync",
  operationId: "setQuillsBoardTaskSync",
  summary: "Set a board's task sync setting",
  description:
    "When a Kaneo task that is linked to a post on this board moves to a done column, the post gets this status. The status must be a live post status of the workspace. Null turns the sync off. Keeps every other board setting.",
  action: "manage_settings",
  params: boardParams,
  body: z.object({
    statusOnTaskDone: flexibleToTypeIdSchema("post_status").nullable(),
  }),
  response: taskSync,
  responseDescription: "Task sync setting",
  errors,
  event: ({ params }) => ({
    type: "board.settings_updated",
    entityType: "board",
    entityId: params.boardId,
    payload: { fields: "taskSync" },
  }),
  load: loadProjects,
  handler: async ({ db, params, body, loaded: projects }) => {
    const board = await findBoard(db, params.boardId, projects);
    if (body.statusOnTaskDone) {
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(
          and(
            eq(postStatuses.id, body.statusOnTaskDone),
            isNull(postStatuses.deletedAt),
          ),
        );
      if (!status)
        throw new HTTPException(404, { message: "Status not found" });
    }
    const patch = {
      taskSync: { statusOnTaskDone: body.statusOnTaskDone },
    };
    // jsonb || merges in one statement, so a parallel write of another key is kept.
    const [row] = await db
      .update(boards)
      .set({
        settings: sql`${boards.settings} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(boards.id, board.id))
      .returning({ settings: boards.settings });
    return {
      boardId: board.id,
      statusOnTaskDone: statusOnTaskDone(row!.settings),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getTaskSync)
  .openapi(...setTaskSync);
