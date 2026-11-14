import { eq, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { defineQuillsRoute } from "../framework/define-route";
import {
  checkTaskSyncStatus,
  statusOnTaskDone,
  taskSyncInput,
  taskSyncView,
} from "../integrations/task-sync";
import { DEFAULT_SORTS, VOTE_DISPLAYS, votingOf } from "./board-voting";
import { findBoard, loadProjects } from "./visibility";

// The voting-bias settings of a board (RFC 0003, feature 9) and its task sync (feature 12). They live
// in boards.settings next to keys that other features own; a write changes only its own keys.

const boardParams = z.object({ boardId: flexibleToTypeIdSchema("board") });
const voteDisplay = z.enum(VOTE_DISPLAYS).openapi({
  description:
    "hidden leaves vote counts out of portal and widget responses. Voting still works.",
});
const defaultSort = z.enum(DEFAULT_SORTS).nullable().openapi({
  description:
    "The order of the board's portal and widget posts when the caller names none. random is stable for one viewer for one UTC day. Null: newest in the API, the portal's own default in the web portal.",
});
const voting = z.object({
  boardId: z.string(),
  voteDisplay,
  defaultSort,
  taskSync: taskSyncView,
});
/** The response view of the stored settings. */
const view = (boardId: string, settings: unknown) => ({
  boardId,
  ...votingOf(settings),
  taskSync: { statusOnTaskDone: statusOnTaskDone(settings) },
});
const errors = { 404: "Board or status not found" };

const getSettings = defineQuillsRoute({
  method: "get",
  path: "/boards/{boardId}/settings",
  operationId: "getQuillsBoardSettings",
  summary: "Get a board's voting and task sync settings",
  action: "read",
  params: boardParams,
  response: voting,
  responseDescription: "Voting and task sync settings",
  errors,
  load: loadProjects,
  handler: async ({ db, params, loaded: projects }) => {
    const board = await findBoard(db, params.boardId, projects);
    const [row] = await db
      .select({ settings: boards.settings })
      .from(boards)
      .where(eq(boards.id, board.id));
    return view(board.id, row!.settings);
  },
});

const updateSettings = defineQuillsRoute({
  method: "patch",
  path: "/boards/{boardId}/settings",
  operationId: "updateQuillsBoardSettings",
  summary: "Change a board's voting and task sync settings",
  description:
    "Changes only the given keys and keeps every other board setting. defaultSort null removes the board's default. taskSync.statusOnTaskDone must be a live post status of the workspace; null turns the sync off.",
  action: "manage_settings",
  params: boardParams,
  body: z
    .object({
      voteDisplay: voteDisplay.optional(),
      defaultSort: defaultSort.optional(),
      taskSync: taskSyncInput.optional(),
    })
    .refine(
      (body) =>
        body.voteDisplay !== undefined ||
        body.defaultSort !== undefined ||
        body.taskSync !== undefined,
      { message: "Provide at least one field" },
    ),
  response: voting,
  responseDescription: "Voting and task sync settings",
  errors,
  event: ({ params, body }) => ({
    type: "board.settings_updated",
    entityType: "board",
    entityId: params.boardId,
    payload: {
      fields: Object.entries(body)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
        .join(","),
    },
  }),
  load: loadProjects,
  handler: async ({ db, params, body, loaded: projects }) => {
    const board = await findBoard(db, params.boardId, projects);
    await checkTaskSyncStatus(db, body.taskSync?.statusOnTaskDone ?? null);
    const patch = {
      ...(body.voteDisplay !== undefined && { voteDisplay: body.voteDisplay }),
      ...(body.defaultSort !== undefined && { defaultSort: body.defaultSort }),
      ...(body.taskSync && {
        taskSync: { statusOnTaskDone: body.taskSync.statusOnTaskDone },
      }),
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
    return view(board.id, row!.settings);
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSettings)
  .openapi(...updateSettings);
