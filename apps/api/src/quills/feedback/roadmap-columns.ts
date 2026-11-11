import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { RoadmapColumnId, RoadmapId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { roadmapColumns } from "../../database/quills/schema/boards";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute } from "../framework/define-route";
import {
  column,
  columnFields,
  columnInput,
  roadmapById,
  roadmapParams,
} from "./roadmaps";
import { someField } from "./schemas";

const params = roadmapParams.extend({
  columnId: flexibleToTypeIdSchema("roadmap_col"),
});
const errors = { 404: "Roadmap or column not found" };
// A column of another roadmap is not found, like a missing one.
const ofRoadmap = (roadmapId: RoadmapId, columnId: RoadmapColumnId) =>
  and(eq(roadmapColumns.id, columnId), eq(roadmapColumns.roadmapId, roadmapId));
const columnNotFound = () =>
  new HTTPException(404, { message: "Column not found" });
const columnEvent =
  (type: "roadmap.column_updated" | "roadmap.column_deleted") =>
  ({ params }: { params: { columnId: string; roadmapId: string } }) => ({
    type,
    entityType: "roadmap" as const,
    entityId: params.roadmapId,
    payload: { columnId: params.columnId },
  });

const listColumns = defineQuillsRoute({
  method: "get",
  path: "/roadmaps/{roadmapId}/columns",
  operationId: "listQuillsRoadmapColumns",
  summary: "List the columns of a roadmap",
  action: "read",
  params: roadmapParams,
  response: z.object({ columns: z.array(column) }),
  responseDescription: "Columns in position order",
  errors,
  handler: async ({ db, params }) => ({
    columns: (await roadmapById(db, params.roadmapId)).columns,
  }),
});

const createColumn = defineQuillsRoute({
  method: "post",
  path: "/roadmaps/{roadmapId}/columns",
  operationId: "createQuillsRoadmapColumn",
  summary: "Add a status column to a roadmap",
  action: "manage_settings",
  params: roadmapParams,
  body: z.object(columnInput),
  response: column,
  responseDescription: "The created column",
  errors: {
    404: "Roadmap or status not found",
    409: "Date roadmap, or the status already has a column",
  },
  event: ({ params }, result) => ({
    type: "roadmap.column_created",
    entityType: "roadmap",
    entityId: params.roadmapId,
    payload: { columnId: result.id },
  }),
  handler: async ({ db, params: { roadmapId }, body }) => {
    const roadmap = await roadmapById(db, roadmapId);
    if (roadmap.type !== "column")
      throw new HTTPException(409, {
        message: "Date roadmaps have no status columns",
      });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(
        and(eq(postStatuses.id, body.statusId), isNull(postStatuses.deletedAt)),
      );
    if (!status) throw new HTTPException(404, { message: "Status not found" });
    const [row] = await db
      .insert(roadmapColumns)
      .values({
        roadmapId,
        statusId: body.statusId,
        name: body.name,
        icon: body.icon || null,
        color: body.color,
        position: body.position ?? roadmap.columns.length,
      })
      .onConflictDoNothing()
      .returning(columnFields);
    if (!row)
      throw new HTTPException(409, {
        message: "This status already has a column on the roadmap",
      });
    return row;
  },
});

const updateColumn = defineQuillsRoute({
  method: "patch",
  path: "/roadmaps/{roadmapId}/columns/{columnId}",
  operationId: "updateQuillsRoadmapColumn",
  summary: "Update a roadmap column",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: columnInput.name.optional(),
      icon: columnInput.icon,
      color: columnInput.color.optional(),
      position: columnInput.position,
    })
    .refine(someField, "Change at least one field"),
  response: column,
  responseDescription: "The updated column",
  errors,
  event: columnEvent("roadmap.column_updated"),
  handler: async ({ db, params: { roadmapId, columnId }, body }) => {
    await roadmapById(db, roadmapId);
    const [row] = await db
      .update(roadmapColumns)
      .set({
        name: body.name,
        icon: body.icon === undefined ? undefined : body.icon || null,
        color: body.color,
        position: body.position,
        updatedAt: new Date(),
      })
      .where(ofRoadmap(roadmapId, columnId))
      .returning(columnFields);
    if (!row) throw columnNotFound();
    return row;
  },
});

const deleteColumn = defineQuillsRoute({
  method: "delete",
  path: "/roadmaps/{roadmapId}/columns/{columnId}",
  operationId: "deleteQuillsRoadmapColumn",
  summary: "Delete a roadmap column",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted column",
  errors,
  event: columnEvent("roadmap.column_deleted"),
  handler: async ({ db, params: { roadmapId, columnId } }) => {
    await roadmapById(db, roadmapId);
    const [row] = await db
      .delete(roadmapColumns)
      .where(ofRoadmap(roadmapId, columnId))
      .returning({ id: roadmapColumns.id });
    if (!row) throw columnNotFound();
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listColumns)
  .openapi(...createColumn)
  .openapi(...updateColumn)
  .openapi(...deleteColumn);
