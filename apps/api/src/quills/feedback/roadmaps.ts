import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type {
  BoardId,
  PostStatusId,
  PostTagId,
  RoadmapId,
  SegmentId,
} from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  boards,
  postTags,
  roadmapColumns,
  roadmaps,
} from "../../database/quills/schema/boards";
import { segments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { checkOrder, positionCase, requireAll } from "./id-sets";
import { idList, page, pageQuery, someField } from "./schemas";

export type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const TYPES = ["column", "date"] as const;
const FREQUENCIES = ["monthly", "quarterly", "semiannual"] as const;
const VISIBILITIES = ["public", "team", "segment"] as const;

export const column = z
  .object({
    id: z.string(),
    roadmapId: z.string(),
    statusId: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    color: z.string(),
    position: z.number(),
  })
  .openapi("QuillsRoadmapColumn");
export const columnFields = {
  id: roadmapColumns.id,
  roadmapId: roadmapColumns.roadmapId,
  statusId: roadmapColumns.statusId,
  name: roadmapColumns.name,
  icon: roadmapColumns.icon,
  color: roadmapColumns.color,
  position: roadmapColumns.position,
};
const ids = z.array(z.string()).optional();
const roadmap = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    type: z.enum(TYPES),
    baseFilter: z.object({
      statusIds: ids,
      boardIds: ids,
      tagIds: ids,
      segmentIds: ids,
    }),
    dateSource: z.enum(["eta"]).nullable(),
    frequency: z.enum(FREQUENCIES).nullable(),
    visibility: z.enum(VISIBILITIES),
    visibleSegmentIds: z.array(z.string()).nullable(),
    position: z.number(),
    columns: z.array(column),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsRoadmap");
const fields = {
  id: roadmaps.id,
  name: roadmaps.name,
  slug: roadmaps.slug,
  description: roadmaps.description,
  type: roadmaps.type,
  baseFilter: roadmaps.baseFilter,
  dateSource: roadmaps.dateSource,
  frequency: roadmaps.frequency,
  visibility: roadmaps.visibility,
  visibleSegmentIds: roadmaps.visibleSegmentIds,
  position: roadmaps.position,
  createdAt: roadmaps.createdAt,
  updatedAt: roadmaps.updatedAt,
};

export const roadmapParams = z.object({
  roadmapId: flexibleToTypeIdSchema("roadmap"),
});
export const columnInput = {
  statusId: flexibleToTypeIdSchema("post_status"),
  name: z.string().trim().min(1).max(100),
  icon: z.string().trim().max(50).nullable().optional(),
  color: z.string().trim().min(1).max(50),
  position: z.number().int().min(0).max(10000).optional(),
};
type ColumnInput = {
  statusId: PostStatusId;
  name: string;
  icon?: string | null;
  color: string;
  position?: number;
};
const configInput = {
  type: z.enum(TYPES).optional(),
  baseFilter: z
    .object({
      statusIds: idList("post_status").optional(),
      boardIds: idList("board").optional(),
      tagIds: idList("post_tag").optional(),
      segmentIds: idList("segment").optional(),
    })
    .strict()
    .optional(),
  frequency: z.enum(FREQUENCIES).nullable().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  visibleSegmentIds: idList("segment").nullable().optional(),
  columns: z.array(z.object(columnInput)).max(50).optional(),
};
type ConfigInput = {
  type?: (typeof TYPES)[number];
  frequency?: (typeof FREQUENCIES)[number] | null;
  visibility?: (typeof VISIBILITIES)[number];
  visibleSegmentIds?: SegmentId[] | null;
  columns?: ColumnInput[];
};

const live = (id: RoadmapId) =>
  and(eq(roadmaps.id, id), isNull(roadmaps.deletedAt));
export const roadmapNotFound = () =>
  new HTTPException(404, { message: "Roadmap not found" });
const bad = (message: string) => new HTTPException(400, { message });

/** A live roadmap with its columns in position order. */
export async function roadmapById(db: Db, id: RoadmapId) {
  const [row] = await db.select(fields).from(roadmaps).where(live(id));
  if (!row) throw roadmapNotFound();
  const columns = await db
    .select(columnFields)
    .from(roadmapColumns)
    .where(eq(roadmapColumns.roadmapId, id))
    .orderBy(asc(roadmapColumns.position), asc(roadmapColumns.id));
  return { ...row, columns };
}

/** The stored type, date source, frequency and audience after applying the input, as the source validates them. */
function resolveConfig(
  input: ConfigInput,
  current?: Pick<
    typeof roadmaps.$inferSelect,
    "type" | "frequency" | "visibility" | "visibleSegmentIds"
  >,
) {
  const type = input.type ?? current?.type ?? "column";
  if (type === "column" && input.frequency)
    throw bad("Column roadmaps cannot have a frequency");
  const visibility = input.visibility ?? current?.visibility ?? "public";
  const visibleSegmentIds =
    visibility === "segment"
      ? input.visibleSegmentIds !== undefined
        ? input.visibleSegmentIds
        : (current?.visibleSegmentIds ?? null)
      : null;
  if (visibility === "segment" && !visibleSegmentIds?.length)
    throw bad("Segment-visible roadmaps need at least one segment");
  const statuses = (input.columns ?? []).map((c) => c.statusId);
  if (new Set(statuses).size !== statuses.length)
    throw bad("Each status can appear only once in a roadmap");
  return {
    type,
    dateSource: type === "date" ? ("eta" as const) : null,
    frequency:
      type === "date"
        ? (input.frequency ?? current?.frequency ?? "monthly")
        : null,
    visibility,
    visibleSegmentIds,
  };
}

/** Every referenced status, board, tag and segment is a live row of this workspace. */
async function requireRefs(
  db: Db,
  refs: {
    statuses: PostStatusId[];
    boards: BoardId[];
    tags: PostTagId[];
    segments: SegmentId[];
  },
) {
  if (refs.statuses.length)
    requireAll(
      refs.statuses,
      await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(
          and(
            inArray(postStatuses.id, refs.statuses),
            isNull(postStatuses.deletedAt),
          ),
        ),
      "Status",
    );
  if (refs.boards.length)
    requireAll(
      refs.boards,
      await db
        .select({ id: boards.id })
        .from(boards)
        .where(and(inArray(boards.id, refs.boards), isNull(boards.deletedAt))),
      "Board",
    );
  if (refs.tags.length)
    requireAll(
      refs.tags,
      await db
        .select({ id: postTags.id })
        .from(postTags)
        .where(
          and(inArray(postTags.id, refs.tags), isNull(postTags.deletedAt)),
        ),
      "Tag",
    );
  if (refs.segments.length)
    requireAll(
      refs.segments,
      await db
        .select({ id: segments.id })
        .from(segments)
        .where(
          and(inArray(segments.id, refs.segments), isNull(segments.deletedAt)),
        ),
      "Segment",
    );
}

const refsOf = (
  body: {
    baseFilter?: {
      statusIds?: PostStatusId[];
      boardIds?: BoardId[];
      tagIds?: PostTagId[];
      segmentIds?: SegmentId[];
    };
    visibleSegmentIds?: SegmentId[] | null;
  },
  columns: ColumnInput[],
) => ({
  statuses: [
    ...new Set([
      ...(body.baseFilter?.statusIds ?? []),
      ...columns.map((c) => c.statusId),
    ]),
  ],
  boards: body.baseFilter?.boardIds ?? [],
  tags: body.baseFilter?.tagIds ?? [],
  segments: [
    ...new Set([
      ...(body.baseFilter?.segmentIds ?? []),
      ...(body.visibleSegmentIds ?? []),
    ]),
  ],
});

async function replaceColumns(db: Db, id: RoadmapId, columns: ColumnInput[]) {
  await db.delete(roadmapColumns).where(eq(roadmapColumns.roadmapId, id));
  if (columns.length)
    await db.insert(roadmapColumns).values(
      columns.map((c, index) => ({
        roadmapId: id,
        statusId: c.statusId,
        name: c.name,
        icon: c.icon || null,
        color: c.color,
        position: c.position ?? index,
      })),
    );
}

/** A new column roadmap starts with the statuses marked "show on roadmap". */
const defaultColumns = async (db: Db): Promise<ColumnInput[]> =>
  (
    await db
      .select({
        statusId: postStatuses.id,
        name: postStatuses.name,
        color: postStatuses.color,
      })
      .from(postStatuses)
      .where(
        and(
          eq(postStatuses.showOnRoadmap, true),
          isNull(postStatuses.deletedAt),
        ),
      )
      .orderBy(
        sql`array_position(array['active','complete','closed'], ${postStatuses.category})`,
        asc(postStatuses.position),
      )
  ).map((status, position) => ({ ...status, position }));

const listRoadmaps = defineQuillsRoute({
  method: "get",
  path: "/roadmaps",
  operationId: "listQuillsRoadmaps",
  summary: "List roadmaps",
  action: "read",
  query: z.object(pageQuery),
  response: z.object({
    roadmaps: z.array(roadmap),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Roadmaps in position order",
  handler: async ({ db, query }) => {
    const { items, nextOffset } = page(
      await db
        .select(fields)
        .from(roadmaps)
        .where(isNull(roadmaps.deletedAt))
        .orderBy(asc(roadmaps.position), asc(roadmaps.id))
        .offset(query.offset)
        .limit(query.limit + 1),
      query,
    );
    const columns = items.length
      ? await db
          .select(columnFields)
          .from(roadmapColumns)
          .where(
            inArray(
              roadmapColumns.roadmapId,
              items.map((r) => r.id),
            ),
          )
          .orderBy(asc(roadmapColumns.position), asc(roadmapColumns.id))
      : [];
    return {
      roadmaps: items.map((r) => ({
        ...r,
        columns: columns.filter((c) => c.roadmapId === r.id),
      })),
      nextOffset,
    };
  },
});

const getRoadmap = defineQuillsRoute({
  method: "get",
  path: "/roadmaps/{roadmapId}",
  operationId: "getQuillsRoadmap",
  summary: "Get a roadmap",
  action: "read",
  params: roadmapParams,
  response: roadmap,
  responseDescription: "The roadmap and its columns",
  errors: { 404: "Roadmap not found" },
  handler: ({ db, params }) => roadmapById(db, params.roadmapId),
});

const createRoadmap = defineQuillsRoute({
  method: "post",
  path: "/roadmaps",
  operationId: "createQuillsRoadmap",
  summary: "Create a roadmap",
  action: "manage_settings",
  body: z.object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens"),
    description: z.string().trim().max(500).optional(),
    ...configInput,
  }),
  response: roadmap,
  responseDescription: "The created roadmap",
  errors: {
    404: "A referenced status, board, tag or segment was not found",
    409: "A roadmap with this slug exists",
  },
  event: (_input, result) => ({
    type: "roadmap.created",
    entityType: "roadmap",
    entityId: result.id,
  }),
  handler: async ({ db, body }) => {
    const config = resolveConfig(body);
    const columns =
      config.type === "column"
        ? (body.columns ?? (await defaultColumns(db)))
        : [];
    await requireRefs(db, refsOf(body, columns));
    const [next] = await db
      .select({
        position: sql<number>`coalesce(max(${roadmaps.position}), -1)::int + 1`,
      })
      .from(roadmaps);
    const [row] = await db
      .insert(roadmaps)
      .values({
        name: body.name,
        slug: body.slug,
        description: body.description || null,
        baseFilter: body.baseFilter ?? {},
        ...config,
        position: next!.position,
      })
      .onConflictDoNothing()
      .returning({ id: roadmaps.id });
    if (!row)
      throw new HTTPException(409, {
        message: `A roadmap with slug "${body.slug}" already exists`,
      });
    await replaceColumns(db, row.id, columns);
    return roadmapById(db, row.id);
  },
});

const updateRoadmap = defineQuillsRoute({
  method: "patch",
  path: "/roadmaps/{roadmapId}",
  operationId: "updateQuillsRoadmap",
  summary: "Update a roadmap",
  description:
    "A columns list replaces every column. A date roadmap has no columns.",
  action: "manage_settings",
  params: roadmapParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().trim().max(500).nullable().optional(),
      ...configInput,
    })
    .refine(someField, "Change at least one field"),
  response: roadmap,
  responseDescription: "The updated roadmap",
  errors: {
    404: "Roadmap, status, board, tag or segment not found",
  },
  event: ({ params }) => ({
    type: "roadmap.updated",
    entityType: "roadmap",
    entityId: params.roadmapId,
  }),
  handler: async ({ db, params: { roadmapId }, body }) => {
    const [current] = await db
      .select({
        type: roadmaps.type,
        frequency: roadmaps.frequency,
        visibility: roadmaps.visibility,
        visibleSegmentIds: roadmaps.visibleSegmentIds,
      })
      .from(roadmaps)
      .where(live(roadmapId))
      .for("update");
    if (!current) throw roadmapNotFound();
    const config = resolveConfig(body, current);
    const columns = config.type === "column" ? (body.columns ?? []) : [];
    await requireRefs(db, refsOf(body, columns));
    await db
      .update(roadmaps)
      .set({
        name: body.name,
        description:
          body.description === undefined ? undefined : body.description || null,
        baseFilter: body.baseFilter,
        ...config,
        updatedAt: new Date(),
      })
      .where(live(roadmapId));
    if (config.type === "date" || body.columns)
      await replaceColumns(db, roadmapId, columns);
    return roadmapById(db, roadmapId);
  },
});

const deleteRoadmap = defineQuillsRoute({
  method: "delete",
  path: "/roadmaps/{roadmapId}",
  operationId: "deleteQuillsRoadmap",
  summary: "Delete a roadmap",
  action: "manage_settings",
  params: roadmapParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted roadmap",
  errors: { 404: "Roadmap not found" },
  event: ({ params }) => ({
    type: "roadmap.deleted",
    entityType: "roadmap",
    entityId: params.roadmapId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(roadmaps)
      .set({ deletedAt: new Date() })
      .where(live(params.roadmapId))
      .returning({ id: roadmaps.id });
    if (!row) throw roadmapNotFound();
    return row;
  },
});

const reorderRoadmaps = defineQuillsRoute({
  method: "put",
  path: "/roadmaps/order",
  operationId: "reorderQuillsRoadmaps",
  summary: "Reorder all roadmaps",
  description:
    "Send every live roadmap ID once, in the new order. A partial or stale list changes nothing.",
  action: "manage_settings",
  body: z.object({ roadmapIds: idList("roadmap").min(1) }),
  response: z.object({ roadmapIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: { 404: "Roadmap not found", 409: "The list is partial or stale" },
  event: ({ workspaceId, body }) => ({
    type: "roadmap.reordered",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { count: String(body.roadmapIds.length) },
  }),
  handler: async ({ db, body: { roadmapIds } }) => {
    const rows = await db
      .select({ id: roadmaps.id })
      .from(roadmaps)
      .where(isNull(roadmaps.deletedAt))
      .for("update");
    checkOrder(
      roadmapIds,
      rows.map((row) => row.id),
    );
    await db
      .update(roadmaps)
      .set({ position: positionCase(roadmaps.id, roadmapIds) })
      .where(inArray(roadmaps.id, roadmapIds));
    return { roadmapIds };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reorderRoadmaps)
  .openapi(...listRoadmaps)
  .openapi(...getRoadmap)
  .openapi(...createRoadmap)
  .openapi(...updateRoadmap)
  .openapi(...deleteRoadmap);
