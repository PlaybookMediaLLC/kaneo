import { eq, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { defineQuillsRoute } from "../framework/define-route";
import {
  checkTaskSyncStatus,
  statusOnTaskDone,
  statusOnTaskInProgress,
  statusOnTaskPlanned,
  taskSyncInput,
  taskSyncView,
} from "../integrations/task-sync";
import { deliveryOf, deliveryView } from "../integrations/post-task";
import { DEFAULT_SORTS, VOTE_DISPLAYS, votingOf } from "./board-voting";
import { fieldDefinition, fieldDefinitions, fieldsOf } from "./custom-fields";
import { findBoard, loadProjects } from "./visibility";

// The voting-bias settings of a board (RFC 0003, feature 9), its task sync (feature 12) and its custom
// fields (issue #71). They live in boards.settings next to keys that other features own; a write
// changes only its own keys.

const boardParams = z.object({ boardId: flexibleToTypeIdSchema("board") });
const voteDisplay = z.enum(VOTE_DISPLAYS).openapi({
  description:
    "hidden leaves vote counts out of portal and widget responses. Voting still works.",
});
const defaultSort = z.enum(DEFAULT_SORTS).nullable().openapi({
  description:
    "The order of the board's portal and widget posts when the caller names none. random is stable for one viewer for one UTC day. Null: newest in the API, the portal's own default in the web portal.",
});
const customFields = fieldDefinitions.openapi({
  description:
    "The fields that the board asks for (at most 20). An internal field is for teammates only: the portal, the widget and customer responses never include it. A required checkbox must be checked.",
});
const voting = z.object({
  boardId: z.string(),
  voteDisplay,
  defaultSort,
  taskSync: taskSyncView,
  customFields: z.array(fieldDefinition),
  delivery: deliveryView,
});
/** The response view of the stored settings. */
const view = (boardId: string, settings: unknown) => {
  const planned = statusOnTaskPlanned(settings);
  const inProgress = statusOnTaskInProgress(settings);
  return {
    boardId,
    ...votingOf(settings),
    taskSync: {
      statusOnTaskDone: statusOnTaskDone(settings),
      ...(planned !== null && { statusOnTaskPlanned: planned }),
      ...(inProgress !== null && { statusOnTaskInProgress: inProgress }),
    },
    customFields: fieldsOf(settings),
    delivery: deliveryOf(settings),
  };
};
const errors = { 404: "Board or status not found" };

const getSettings = defineQuillsRoute({
  method: "get",
  path: "/boards/{boardId}/settings",
  operationId: "getQuillsBoardSettings",
  summary: "Get a board's voting, task sync and custom field settings",
  action: "read",
  params: boardParams,
  response: voting,
  responseDescription: "Voting, task sync and custom field settings",
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
  summary: "Change a board's voting, task sync and custom field settings",
  description:
    "Changes only the given keys and keeps every other board setting. defaultSort null removes the board's default. taskSync status IDs must be live post statuses of the workspace; null turns the sync off. customFields replaces the board's whole field list; values that posts already hold stay stored.",
  action: "manage_settings",
  params: boardParams,
  body: z
    .object({
      voteDisplay: voteDisplay.optional(),
      defaultSort: defaultSort.optional(),
      taskSync: taskSyncInput.optional(),
      customFields: customFields.optional(),
    })
    .refine(
      (body) =>
        body.voteDisplay !== undefined ||
        body.defaultSort !== undefined ||
        body.taskSync !== undefined ||
        body.customFields !== undefined,
      { message: "Provide at least one field" },
    ),
  response: voting,
  responseDescription: "Voting, task sync and custom field settings",
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
    await checkTaskSyncStatus(db, body.taskSync?.statusOnTaskPlanned ?? null);
    await checkTaskSyncStatus(
      db,
      body.taskSync?.statusOnTaskInProgress ?? null,
    );
    const patch = {
      ...(body.voteDisplay !== undefined && { voteDisplay: body.voteDisplay }),
      ...(body.defaultSort !== undefined && { defaultSort: body.defaultSort }),
      ...(body.taskSync && {
        taskSync: {
          statusOnTaskDone: body.taskSync.statusOnTaskDone,
          ...(body.taskSync.statusOnTaskPlanned !== undefined && {
            statusOnTaskPlanned: body.taskSync.statusOnTaskPlanned,
          }),
          ...(body.taskSync.statusOnTaskInProgress !== undefined && {
            statusOnTaskInProgress: body.taskSync.statusOnTaskInProgress,
          }),
        },
      }),
      ...(body.customFields && { customFields: body.customFields }),
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
