import { and, asc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  userTagAssignments,
  userTags,
} from "../../database/quills/schema/user-tags";
import { defineQuillsRoute } from "../framework/define-route";
import { loadCustomer } from "./customer";

const tag = z.object({ id: z.string(), name: z.string(), color: z.string() });
const tagFields = {
  id: userTags.id,
  name: userTags.name,
  color: userTags.color,
};
const live = isNull(userTags.deletedAt);
const principalId = flexibleToTypeIdSchema("principal");

const listTags = defineQuillsRoute({
  method: "get",
  path: "/user-tags",
  operationId: "listQuillsUserTags",
  summary: "List user tags",
  action: "read",
  response: z.object({ tags: z.array(tag) }),
  responseDescription: "Live user tags, up to 500",
  handler: async ({ db }) => ({
    tags: await db
      .select(tagFields)
      .from(userTags)
      .where(live)
      .orderBy(asc(userTags.name))
      .limit(500),
  }),
});

const listForPerson = defineQuillsRoute({
  method: "get",
  path: "/users/{principalId}/tags",
  operationId: "listQuillsUserTagsForPrincipal",
  summary: "List the tags on a customer",
  action: "read",
  params: z.object({ principalId }),
  response: z.object({ tags: z.array(tag) }),
  responseDescription: "The customer's tags",
  errors: { 404: "Person not found" },
  handler: async ({ db, params }) => {
    await loadCustomer(db, params.principalId);
    return {
      tags: await db
        .select(tagFields)
        .from(userTagAssignments)
        .innerJoin(userTags, eq(userTags.id, userTagAssignments.tagId))
        .where(
          and(eq(userTagAssignments.principalId, params.principalId), live),
        )
        .orderBy(asc(userTags.name))
        .limit(500),
    };
  },
});

const assignTag = defineQuillsRoute({
  method: "put",
  path: "/users/{principalId}/tags",
  operationId: "assignQuillsUserTag",
  summary: "Tag a customer by tag ID, or by name (created when missing)",
  action: "update",
  params: z.object({ principalId }),
  body: z
    .object({
      tagId: flexibleToTypeIdSchema("user_tag").optional(),
      name: z.string().trim().min(1).max(100).optional(),
    })
    .refine((b) => Boolean(b.tagId) !== Boolean(b.name), "Send tagId or name"),
  response: tag,
  responseDescription: "The assigned tag",
  errors: { 404: "Person or tag not found" },
  event: ({ params }, result) => ({
    type: "user.tagged",
    entityType: "principal",
    entityId: params.principalId,
    payload: { tagId: result.id },
  }),
  handler: async ({ db, params, body }) => {
    await loadCustomer(db, params.principalId);
    let [found] = await db
      .select(tagFields)
      .from(userTags)
      .where(
        and(
          body.tagId
            ? eq(userTags.id, body.tagId)
            : eq(userTags.name, body.name!),
          live,
        ),
      )
      .limit(1);
    if (!found && body.tagId)
      throw new HTTPException(404, { message: "Tag not found" });
    // A soft-deleted tag of the same name comes back (the name is unique per workspace).
    found ??= (
      await db
        .insert(userTags)
        .values({ name: body.name! })
        .onConflictDoUpdate({
          target: [userTags.workspaceId, userTags.name],
          set: { deletedAt: null },
        })
        .returning(tagFields)
    )[0]!;
    await db
      .insert(userTagAssignments)
      .values({ principalId: params.principalId, tagId: found.id })
      .onConflictDoNothing();
    return found;
  },
});

const removeTag = defineQuillsRoute({
  method: "delete",
  path: "/users/{principalId}/tags/{tagId}",
  operationId: "removeQuillsUserTag",
  summary: "Remove a tag from a customer",
  action: "update",
  params: z.object({ principalId, tagId: flexibleToTypeIdSchema("user_tag") }),
  response: z.object({ removed: z.boolean() }),
  responseDescription: "Whether the tag was on the customer",
  errors: { 404: "Person or tag not found" },
  event: ({ params }) => ({
    type: "user.untagged",
    entityType: "principal",
    entityId: params.principalId,
    payload: { tagId: params.tagId },
  }),
  handler: async ({ db, params }) => {
    await loadCustomer(db, params.principalId);
    const [found] = await db
      .select({ id: userTags.id })
      .from(userTags)
      .where(eq(userTags.id, params.tagId))
      .limit(1);
    if (!found) throw new HTTPException(404, { message: "Tag not found" });
    const rows = await db
      .delete(userTagAssignments)
      .where(
        and(
          eq(userTagAssignments.principalId, params.principalId),
          eq(userTagAssignments.tagId, params.tagId),
        ),
      )
      .returning({ tagId: userTagAssignments.tagId });
    return { removed: rows.length > 0 };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listTags)
  .openapi(...listForPerson)
  .openapi(...assignTag)
  .openapi(...removeTag);
