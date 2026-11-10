import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { toUuid } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { defineQuillsRoute } from "../framework/define-route";
import { isCustomer, type PrincipalId } from "./customer";
import {
  evaluateSegment,
  fromStored,
  MAX_DYNAMIC_MEMBERS,
  rulesOutput,
  rulesSchema,
  toStored,
  type Db,
} from "./segment-rules";

const memberCount = sql<number>`(select count(*)::int from ${userSegments} m where m.segment_id = ${segments.id})`;
const segmentFields = {
  id: segments.id,
  name: segments.name,
  slug: segments.slug,
  description: segments.description,
  type: segments.type,
  color: segments.color,
  rules: segments.rules,
  memberCount,
  createdAt: segments.createdAt,
  updatedAt: segments.updatedAt,
};
const segment = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  color: z.string(),
  rules: rulesOutput.nullable(),
  memberCount: z.number(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
type Row = Awaited<ReturnType<typeof loadSegment>>;
const toSegment = (row: Row) => ({
  ...row,
  rules: fromStored(row.rules),
  memberCount: Number(row.memberCount),
});
const params = z.object({ segmentId: flexibleToTypeIdSchema("segment") });
const notFound = { 404: "Segment not found" };
type SegmentId = typeof segments.$inferSelect.id;
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .optional();
const evaluation = z.object({
  segmentId: z.string(),
  added: z.number(),
  removed: z.number(),
  members: z.number(),
});
const tooLarge = `The rules match more than ${MAX_DYNAMIC_MEMBERS} people`;

async function loadSegment(db: Db, id: string, lock = false) {
  const query = db
    .select(segmentFields)
    .from(segments)
    .where(and(eq(segments.id, id as SegmentId), isNull(segments.deletedAt)))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new HTTPException(404, { message: "Segment not found" });
  return row;
}

/** A unique live slug from the name. */
async function slugFor(db: Db, name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "segment";
  const taken = await db
    .select({ slug: segments.slug })
    .from(segments)
    .where(
      and(
        isNull(segments.deletedAt),
        sql`${segments.slug} ~ ${`^${base}(-[0-9]+)?$`}`,
      ),
    );
  const used = new Set(taken.map((row) => row.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const listSegments = defineQuillsRoute({
  method: "get",
  path: "/segments",
  operationId: "listQuillsSegments",
  summary: "List segments with member counts",
  action: "read",
  response: z.object({ segments: z.array(segment) }),
  responseDescription: "Live segments, up to 500",
  handler: async ({ db }) => ({
    segments: (
      await db
        .select(segmentFields)
        .from(segments)
        .where(isNull(segments.deletedAt))
        .orderBy(asc(segments.name))
        .limit(500)
    ).map(toSegment),
  }),
});

const attributeValues = defineQuillsRoute({
  method: "get",
  path: "/segments/attribute-values",
  operationId: "listQuillsSegmentAttributeValues",
  summary: "Suggest existing values for a segment rule attribute",
  action: "read",
  query: z.object({
    attribute: z.enum(["country", "locale", "name", "email"]),
    query: z.string().trim().max(200).default(""),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  response: z.object({
    values: z.array(z.object({ value: z.string(), count: z.number() })),
  }),
  responseDescription: "The most common values among identified customers",
  handler: async ({ db, query }) => {
    const column = {
      country: user.country,
      locale: user.locale,
      name: user.name,
      email: user.email,
    }[query.attribute];
    const rows = await db
      .select({ value: column, count: sql<number>`count(*)::int` })
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          isCustomer,
          eq(principal.type, "user"),
          sql`${column} is not null`,
          query.query
            ? sql`lower(${column}) like ${`${query.query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`}`
            : undefined,
        ),
      )
      .groupBy(column)
      .orderBy(sql`count(*) desc`, asc(column))
      .limit(query.limit);
    return {
      values: rows.map((row) => ({
        value: String(row.value),
        count: Number(row.count),
      })),
    };
  },
});

const createSegment = defineQuillsRoute({
  method: "post",
  path: "/segments",
  operationId: "createQuillsSegment",
  summary: "Create a segment",
  description:
    "A dynamic segment needs rules. Run the evaluate route to fill its members.",
  action: "manage_settings",
  body: z
    .object({
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500).nullable().optional(),
      type: z.enum(["manual", "dynamic"]),
      color,
      rules: rulesSchema.optional(),
    })
    .refine((b) => (b.type === "dynamic") === Boolean(b.rules), {
      message: "A dynamic segment needs rules; a manual segment has none",
    }),
  response: segment,
  responseDescription: "The new segment",
  event: (_input, result) => ({
    type: "segment.created",
    entityType: "segment",
    entityId: result.id,
  }),
  handler: async ({ db, body }) => {
    const [row] = await db
      .insert(segments)
      .values({
        name: body.name,
        slug: await slugFor(db, body.name),
        description: body.description,
        type: body.type,
        color: body.color,
        rules: body.rules ? toStored(body.rules) : null,
      })
      .returning({ id: segments.id });
    return toSegment(await loadSegment(db, row!.id));
  },
});

const updateSegment = defineQuillsRoute({
  method: "put",
  path: "/segments/{segmentId}",
  operationId: "updateQuillsSegment",
  summary: "Update a segment",
  description: "The type cannot change. Only a dynamic segment has rules.",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().trim().max(500).nullable().optional(),
      color,
      rules: rulesSchema.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, "Send at least one field"),
  response: segment,
  responseDescription: "The updated segment",
  errors: { ...notFound, 409: "Rules belong to dynamic segments only" },
  event: ({ params }) => ({
    type: "segment.updated",
    entityType: "segment",
    entityId: params.segmentId,
  }),
  handler: async ({ db, params, body }) => {
    const current = await loadSegment(db, params.segmentId, true);
    if (body.rules && current.type !== "dynamic")
      throw new HTTPException(409, {
        message: "Rules belong to dynamic segments only",
      });
    await db
      .update(segments)
      .set({
        name: body.name,
        description: body.description,
        color: body.color,
        rules: body.rules ? toStored(body.rules) : undefined,
      })
      .where(eq(segments.id, params.segmentId));
    return toSegment(await loadSegment(db, params.segmentId));
  },
});

const deleteSegment = defineQuillsRoute({
  method: "delete",
  path: "/segments/{segmentId}",
  operationId: "deleteQuillsSegment",
  summary: "Delete a segment",
  description: "Soft delete. Its memberships are removed.",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted segment",
  errors: notFound,
  event: ({ params }) => ({
    type: "segment.deleted",
    entityType: "segment",
    entityId: params.segmentId,
  }),
  handler: async ({ db, params }) => {
    await loadSegment(db, params.segmentId, true);
    await db
      .update(segments)
      .set({ deletedAt: new Date() })
      .where(eq(segments.id, params.segmentId));
    await db
      .delete(userSegments)
      .where(eq(userSegments.segmentId, params.segmentId));
    return { id: params.segmentId };
  },
});

const members = z.object({
  principalIds: z.array(flexibleToTypeIdSchema("principal")).min(1).max(100),
});

/** Every ID must be a customer of this workspace, or nothing changes. */
async function assertCustomers(db: Db, ids: PrincipalId[]) {
  const unique = [...new Set(ids)];
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(and(isCustomer, inArray(principal.id, unique)));
  if (Number(row?.n) !== unique.length)
    throw new HTTPException(404, { message: "Person not found" });
  return unique;
}

async function manualSegment(db: Db, id: string) {
  const current = await loadSegment(db, id, true);
  if (current.type !== "manual")
    throw new HTTPException(409, {
      message: "Members of a dynamic segment come from its rules",
    });
}

const addMembers = defineQuillsRoute({
  method: "post",
  path: "/segments/{segmentId}/members",
  operationId: "addQuillsSegmentMembers",
  summary: "Add customers to a manual segment",
  description: "All or nothing: an unknown or foreign person changes nothing.",
  action: "manage_settings",
  params,
  body: members,
  response: z.object({ segmentId: z.string(), added: z.number() }),
  responseDescription: "How many memberships were added",
  errors: {
    404: "Segment or person not found",
    409: "The segment is dynamic",
  },
  event: ({ params }, result) => ({
    type: "segment.members_added",
    entityType: "segment",
    entityId: params.segmentId,
    payload: { added: String(result.added) },
  }),
  handler: async ({ db, params, body }) => {
    await manualSegment(db, params.segmentId);
    const ids = await assertCustomers(db, body.principalIds);
    const rows = await db
      .insert(userSegments)
      .values(
        ids.map((principalId) => ({
          principalId,
          segmentId: params.segmentId,
          addedBy: "manual" as const,
        })),
      )
      .onConflictDoNothing()
      .returning({ principalId: userSegments.principalId });
    return { segmentId: params.segmentId, added: rows.length };
  },
});

const removeMembers = defineQuillsRoute({
  method: "delete",
  path: "/segments/{segmentId}/members",
  operationId: "removeQuillsSegmentMembers",
  summary: "Remove customers from a manual segment",
  description: "All or nothing: an unknown or foreign person changes nothing.",
  action: "manage_settings",
  params,
  body: members,
  response: z.object({ segmentId: z.string(), removed: z.number() }),
  responseDescription: "How many memberships were removed",
  errors: {
    404: "Segment or person not found",
    409: "The segment is dynamic",
  },
  event: ({ params }, result) => ({
    type: "segment.members_removed",
    entityType: "segment",
    entityId: params.segmentId,
    payload: { removed: String(result.removed) },
  }),
  handler: async ({ db, params, body }) => {
    await manualSegment(db, params.segmentId);
    const ids = await assertCustomers(db, body.principalIds);
    const rows = await db
      .delete(userSegments)
      .where(
        and(
          eq(userSegments.segmentId, params.segmentId),
          inArray(userSegments.principalId, ids),
        ),
      )
      .returning({ principalId: userSegments.principalId });
    return { segmentId: params.segmentId, removed: rows.length };
  },
});

const evaluateOne = defineQuillsRoute({
  method: "post",
  path: "/segments/{segmentId}/evaluate",
  operationId: "evaluateQuillsSegment",
  summary: "Rebuild the members of a dynamic segment from its rules",
  description: `Fails with 409, and changes nothing, when the rules match more than ${MAX_DYNAMIC_MEMBERS} people.`,
  action: "manage_settings",
  params,
  response: evaluation,
  responseDescription: "The membership change",
  errors: { ...notFound, 409: "The segment is not dynamic or too large" },
  event: ({ params }, result) => ({
    type: "segment.evaluated",
    entityType: "segment",
    entityId: params.segmentId,
    payload: { added: String(result.added), removed: String(result.removed) },
  }),
  handler: async ({ db, params }) => {
    const current = await loadSegment(db, params.segmentId, true);
    if (current.type !== "dynamic")
      throw new HTTPException(409, { message: "The segment is not dynamic" });
    const result = await evaluateSegment(
      db,
      params.segmentId,
      current.rules,
      toUuid(params.segmentId),
    );
    if (!result) throw new HTTPException(409, { message: tooLarge });
    return result;
  },
});

const EVALUATE_ALL_LIMIT = 25;

const evaluateAll = defineQuillsRoute({
  method: "post",
  path: "/segments/evaluate",
  operationId: "evaluateQuillsAllSegments",
  summary: "Rebuild the members of the dynamic segments",
  description: `Evaluates the first ${EVALUATE_ALL_LIMIT} dynamic segments by ID; "truncated" says that more exist. A segment that matches more than ${MAX_DYNAMIC_MEMBERS} people is skipped and keeps its members.`,
  action: "manage_settings",
  response: z.object({
    results: z.array(evaluation.extend({ skipped: z.boolean() })),
    truncated: z.boolean(),
  }),
  responseDescription: "The membership change per segment",
  event: ({ workspaceId }, result) => ({
    type: "segment.evaluated_all",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { segments: String(result.results.length) },
  }),
  handler: async ({ db }) => {
    const rows = await db
      .select({ id: segments.id, rules: segments.rules })
      .from(segments)
      .where(and(eq(segments.type, "dynamic"), isNull(segments.deletedAt)))
      // ponytail: a fixed first page; add a cursor when a workspace needs more than 25 dynamic segments.
      .orderBy(asc(segments.id))
      .limit(EVALUATE_ALL_LIMIT + 1)
      .for("update");
    const results = [];
    for (const row of rows.slice(0, EVALUATE_ALL_LIMIT)) {
      const result = await evaluateSegment(
        db,
        row.id,
        row.rules,
        toUuid(row.id),
      );
      results.push(
        result
          ? { ...result, skipped: false }
          : {
              segmentId: row.id,
              added: 0,
              removed: 0,
              members: 0,
              skipped: true,
            },
      );
    }
    return { results, truncated: rows.length > EVALUATE_ALL_LIMIT };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listSegments)
  .openapi(...attributeValues)
  .openapi(...createSegment)
  .openapi(...evaluateAll)
  .openapi(...updateSegment)
  .openapi(...deleteSegment)
  .openapi(...addMembers)
  .openapi(...removeMembers)
  .openapi(...evaluateOne);
