import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostTagId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { postTags } from "../../database/quills/schema/boards";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { hexColor, page, pageQuery, someField } from "./schemas";

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const tag = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    description: z.string().nullable(),
    aiPrompt: z.string().nullable(),
    isPublic: z.boolean(),
    createdAt: responseTimestamp,
  })
  .openapi("QuillsTag");
const columns = {
  id: postTags.id,
  name: postTags.name,
  color: postTags.color,
  description: postTags.description,
  aiPrompt: postTags.aiPrompt,
  isPublic: postTags.isPublic,
  createdAt: postTags.createdAt,
};
const params = z.object({ tagId: flexibleToTypeIdSchema("post_tag") });
const fields = {
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(200),
  aiPrompt: z.string().trim().max(500),
};
const live = (id: PostTagId) =>
  and(eq(postTags.id, id), isNull(postTags.deletedAt));
const notFound = () => new HTTPException(404, { message: "Tag not found" });
const duplicate = (name: string) =>
  new HTTPException(409, { message: `A tag named "${name}" already exists` });

/** Names are unique without regard to case, also against deleted tags. */
async function assertUniqueName(db: Db, name: string, except?: PostTagId) {
  const [found] = await db
    .select({ id: postTags.id })
    .from(postTags)
    .where(
      and(
        sql`lower(${postTags.name}) = lower(${name})`,
        except ? ne(postTags.id, except) : undefined,
      ),
    )
    .limit(1);
  if (found) throw duplicate(name);
}

const listTags = defineQuillsRoute({
  method: "get",
  path: "/tags",
  operationId: "listQuillsTags",
  summary: "List post tags",
  action: "read",
  query: z.object(pageQuery),
  response: z.object({ tags: z.array(tag), nextOffset: z.number().nullable() }),
  responseDescription: "Tags ordered by name",
  handler: async ({ db, query }) => {
    const rows = await db
      .select(columns)
      .from(postTags)
      .where(isNull(postTags.deletedAt))
      .orderBy(asc(postTags.name), asc(postTags.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    const { items, nextOffset } = page(rows, query);
    return { tags: items, nextOffset };
  },
});

const getTag = defineQuillsRoute({
  method: "get",
  path: "/tags/{tagId}",
  operationId: "getQuillsTag",
  summary: "Get a post tag",
  action: "read",
  params,
  response: tag,
  responseDescription: "The tag",
  errors: { 404: "Tag not found" },
  handler: async ({ db, params }) => {
    const [row] = await db
      .select(columns)
      .from(postTags)
      .where(live(params.tagId));
    if (!row) throw notFound();
    return row;
  },
});

const createTag = defineQuillsRoute({
  method: "post",
  path: "/tags",
  operationId: "createQuillsTag",
  summary: "Create a post tag",
  action: "manage_settings",
  body: z.object({
    name: fields.name,
    color: hexColor.default("#6b7280"),
    description: fields.description.optional(),
    aiPrompt: fields.aiPrompt.optional(),
    isPublic: z.boolean().optional(),
  }),
  response: tag,
  responseDescription: "The created tag",
  errors: { 409: "A tag with this name exists" },
  event: (_input, result) => ({
    type: "tag.created",
    entityType: "tag",
    entityId: result.id,
  }),
  handler: async ({ db, body }) => {
    await assertUniqueName(db, body.name);
    const [row] = await db
      .insert(postTags)
      .values({
        name: body.name,
        color: body.color,
        description: body.description || null,
        aiPrompt: body.aiPrompt || null,
        isPublic: body.isPublic ?? true,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row) throw duplicate(body.name);
    return row;
  },
});

const updateTag = defineQuillsRoute({
  method: "patch",
  path: "/tags/{tagId}",
  operationId: "updateQuillsTag",
  summary: "Update a post tag",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: fields.name.optional(),
      color: hexColor.optional(),
      description: fields.description.nullable().optional(),
      aiPrompt: fields.aiPrompt.nullable().optional(),
      isPublic: z.boolean().optional(),
    })
    .refine(someField, "Change at least one field"),
  response: tag,
  responseDescription: "The updated tag",
  errors: { 404: "Tag not found", 409: "A tag with this name exists" },
  event: ({ params }) => ({
    type: "tag.updated",
    entityType: "tag",
    entityId: params.tagId,
  }),
  handler: async ({ db, params, body }) => {
    if (body.name !== undefined)
      await assertUniqueName(db, body.name, params.tagId);
    const [row] = await db
      .update(postTags)
      .set({
        name: body.name,
        color: body.color,
        description:
          body.description === undefined ? undefined : body.description || null,
        aiPrompt:
          body.aiPrompt === undefined ? undefined : body.aiPrompt || null,
        isPublic: body.isPublic,
      })
      .where(live(params.tagId))
      .returning(columns);
    if (!row) throw notFound();
    return row;
  },
});

// Soft delete, as in the source: assignments stay so the history of a post keeps its tags.
const deleteTag = defineQuillsRoute({
  method: "delete",
  path: "/tags/{tagId}",
  operationId: "deleteQuillsTag",
  summary: "Delete a post tag",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted tag",
  errors: { 404: "Tag not found" },
  event: ({ params }) => ({
    type: "tag.deleted",
    entityType: "tag",
    entityId: params.tagId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(postTags)
      .set({ deletedAt: new Date() })
      .where(live(params.tagId))
      .returning({ id: postTags.id });
    if (!row) throw notFound();
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listTags)
  .openapi(...getTag)
  .openapi(...createTag)
  .openapi(...updateTag)
  .openapi(...deleteTag);
