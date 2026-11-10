import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../database/quills/schema/conversation";
import { macros } from "../../database/quills/schema/macros";
import { workflows } from "../../database/quills/schema/workflows";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { hexColor } from "../feedback/schemas";
import {
  conflict,
  conversationParams,
  errors,
  findConversation,
  notFound,
  notTestConversation,
} from "./conversation-model";
import { attachTag, resolveLiveTag } from "./conversation-ops";

const tagParams = z.object({
  tagId: flexibleToTypeIdSchema("conversation_tag"),
});
const name = z.string().trim().min(1).max(50);
const tag = z.object({ id: z.string(), name: z.string(), color: z.string() });
const tagFields = {
  id: conversationTags.id,
  name: conversationTags.name,
  color: conversationTags.color,
};
type TagId = TypeId<"conversation_tag">;

const tagEvent =
  (
    type:
      | "conversation_tag.updated"
      | "conversation_tag.archived"
      | "conversation_tag.restored"
      | "conversation_tag.deleted",
  ) =>
  ({ params }: { params: { tagId: string } }) => ({
    type,
    entityType: "conversation_tag" as const,
    entityId: params.tagId,
  });

async function findTag(db: Database, id: TagId) {
  const [row] = await db
    .select({ ...tagFields, deletedAt: conversationTags.deletedAt })
    .from(conversationTags)
    .where(eq(conversationTags.id, id));
  if (!row) throw notFound("Tag");
  return row;
}

/** Live workflows and macros store tag IDs in their JSON; a referenced tag cannot be archived or deleted. */
async function assertUnreferenced(db: Database, id: TagId) {
  const needle = `%${id}%`;
  const [workflow] = await db
    .select({ name: workflows.name })
    .from(workflows)
    .where(
      and(
        eq(workflows.status, "live"),
        isNull(workflows.deletedAt),
        sql`${workflows.graph}::text like ${needle}`,
      ),
    )
    .limit(1);
  const [macro] = await db
    .select({ name: macros.name })
    .from(macros)
    .where(
      and(
        isNull(macros.deletedAt),
        sql`${macros.actions}::text like ${needle}`,
      ),
    )
    .limit(1);
  const user = workflow
    ? `workflow "${workflow.name}"`
    : macro && `macro "${macro.name}"`;
  if (user) throw conflict(`This tag is used by ${user}. Update it first.`);
}

/** Conversations that count: real (not test) ones. */
const counted = (where?: ReturnType<typeof eq>) =>
  sql<number>`count(${conversations.id}) filter (where ${and(notTestConversation, where)})::int`;

const listTags = defineQuillsRoute({
  method: "get",
  path: "/conversation-tags",
  operationId: "listQuillsConversationTags",
  summary: "List conversation tags",
  description:
    "Live tags by name. counts=true adds the number of open conversations per tag, without test conversations.",
  action: "read",
  query: z.object({ counts: z.enum(["true", "false"]).default("false") }),
  response: z.object({
    items: z.array(tag.extend({ count: z.number().nullable() })),
  }),
  responseDescription: "Tags",
  errors,
  handler: async ({ db, query }) => {
    const rows = await db
      .select({
        ...tagFields,
        count: counted(eq(conversations.status, "open")),
      })
      .from(conversationTags)
      .leftJoin(
        conversationTagAssignments,
        eq(conversationTagAssignments.conversationTagId, conversationTags.id),
      )
      .leftJoin(
        conversations,
        eq(conversations.id, conversationTagAssignments.conversationId),
      )
      .where(isNull(conversationTags.deletedAt))
      .groupBy(
        conversationTags.id,
        conversationTags.name,
        conversationTags.color,
        conversationTags.deletedAt,
      )
      .orderBy(asc(conversationTags.name))
      .limit(1000);
    return {
      items: rows.map((row) => ({
        ...row,
        count: query.counts === "true" ? row.count : null,
      })),
    };
  },
});

const tagUsage = defineQuillsRoute({
  method: "get",
  path: "/conversation-tags/usage",
  operationId: "listQuillsConversationTagUsage",
  summary: "List every conversation tag with its use",
  description:
    "Archived tags included, with the number of conversations each is applied to (test conversations not counted).",
  action: "manage_settings",
  response: z.object({
    items: z.array(tag.extend({ count: z.number(), archived: z.boolean() })),
  }),
  responseDescription: "Tags",
  errors,
  handler: async ({ db }) => {
    const rows = await db
      .select({
        ...tagFields,
        count: counted(),
        archived: sql<boolean>`(${conversationTags.deletedAt} is not null)`,
      })
      .from(conversationTags)
      .leftJoin(
        conversationTagAssignments,
        eq(conversationTagAssignments.conversationTagId, conversationTags.id),
      )
      .leftJoin(
        conversations,
        eq(conversations.id, conversationTagAssignments.conversationId),
      )
      .groupBy(
        conversationTags.id,
        conversationTags.name,
        conversationTags.color,
        conversationTags.deletedAt,
      )
      .orderBy(asc(conversationTags.name))
      .limit(1000);
    return { items: rows };
  },
});

const createTag = defineQuillsRoute({
  method: "post",
  path: "/conversation-tags",
  operationId: "createQuillsConversationTag",
  summary: "Create a conversation tag, or reuse one with the same name",
  description:
    "A live tag with the same name (any case) is returned unchanged. An archived tag with the exact name is restored.",
  action: "manage_settings",
  body: z.object({ name, color: hexColor.default("#6b7280") }),
  response: tag.extend({ created: z.boolean() }),
  responseDescription: "Tag",
  errors,
  event: (_input, result) =>
    result.created && {
      type: "conversation_tag.created",
      entityType: "conversation_tag",
      entityId: result.id,
    },
  handler: async ({ db, body }) => {
    const [live] = await db
      .select(tagFields)
      .from(conversationTags)
      .where(
        and(
          isNull(conversationTags.deletedAt),
          sql`lower(${conversationTags.name}) = ${body.name.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (live) return { ...live, created: false };
    // The name is unique per workspace across archived rows: an archived tag comes back.
    const [row] = await db
      .insert(conversationTags)
      .values({ name: body.name, color: body.color })
      .onConflictDoUpdate({
        target: [conversationTags.workspaceId, conversationTags.name],
        set: { deletedAt: null },
      })
      .returning(tagFields);
    return { ...row!, created: true };
  },
});

const updateTag = defineQuillsRoute({
  method: "patch",
  path: "/conversation-tags/{tagId}",
  operationId: "updateQuillsConversationTag",
  summary: "Rename or recolor a conversation tag",
  description:
    "A name another tag already uses (any case among live tags, exact among archived ones) returns 409.",
  action: "manage_settings",
  params: tagParams,
  body: z
    .object({ name: name.optional(), color: hexColor.optional() })
    .refine((b) => b.name !== undefined || b.color !== undefined, {
      message: "Provide a name or color",
    }),
  response: tag,
  responseDescription: "Tag",
  errors,
  event: tagEvent("conversation_tag.updated"),
  handler: async ({ db, params, body }) => {
    const current = await findTag(db, params.tagId);
    if (current.deletedAt) throw notFound("Tag");
    if (body.name !== undefined) {
      const [taken] = await db
        .select({ id: conversationTags.id })
        .from(conversationTags)
        .where(
          and(
            ne(conversationTags.id, current.id),
            or(
              eq(conversationTags.name, body.name),
              and(
                isNull(conversationTags.deletedAt),
                sql`lower(${conversationTags.name}) = ${body.name.toLowerCase()}`,
              ),
            ),
          ),
        )
        .limit(1);
      if (taken) throw conflict("A tag with that name already exists");
    }
    const [row] = await db
      .update(conversationTags)
      .set({ name: body.name, color: body.color })
      .where(eq(conversationTags.id, current.id))
      .returning(tagFields);
    return row!;
  },
});

const archiveTag = defineQuillsRoute({
  method: "delete",
  path: "/conversation-tags/{tagId}",
  operationId: "archiveQuillsConversationTag",
  summary: "Archive a conversation tag",
  description:
    "Soft delete: the tag leaves pickers and lists, assignments stay inert, the name stays reserved. 409 while a live workflow or macro uses it.",
  action: "manage_settings",
  params: tagParams,
  response: tag,
  responseDescription: "Archived tag",
  errors,
  event: tagEvent("conversation_tag.archived"),
  handler: async ({ db, params }) => {
    const current = await findTag(db, params.tagId);
    if (current.deletedAt) throw notFound("Tag");
    await assertUnreferenced(db, current.id);
    const [row] = await db
      .update(conversationTags)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(conversationTags.id, current.id),
          isNull(conversationTags.deletedAt),
        ),
      )
      .returning(tagFields);
    if (!row) throw notFound("Tag");
    return row;
  },
});

const restoreTag = defineQuillsRoute({
  method: "post",
  path: "/conversation-tags/{tagId}/restore",
  operationId: "restoreQuillsConversationTag",
  summary: "Restore an archived conversation tag",
  action: "manage_settings",
  params: tagParams,
  response: tag,
  responseDescription: "Restored tag",
  errors,
  event: tagEvent("conversation_tag.restored"),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(conversationTags)
      .set({ deletedAt: null })
      .where(
        and(
          eq(conversationTags.id, params.tagId),
          isNotNull(conversationTags.deletedAt),
        ),
      )
      .returning(tagFields);
    if (!row) throw notFound("Archived tag");
    return row;
  },
});

const deleteTag = defineQuillsRoute({
  method: "delete",
  path: "/conversation-tags/{tagId}/permanent",
  operationId: "deleteQuillsConversationTag",
  summary: "Delete an archived conversation tag for good",
  description:
    "Archive first (409 otherwise). Conversations lose the tag. 409 while a live workflow or macro uses it.",
  action: "manage_settings",
  params: tagParams,
  response: z.object({ id: z.string() }),
  responseDescription: "Deleted tag",
  errors,
  event: tagEvent("conversation_tag.deleted"),
  handler: async ({ db, params }) => {
    const current = await findTag(db, params.tagId);
    if (!current.deletedAt)
      throw conflict("Archive the tag before deleting it for good");
    await assertUnreferenced(db, current.id);
    await db
      .delete(conversationTags)
      .where(eq(conversationTags.id, current.id));
    return { id: current.id };
  },
});

const tagsOf = (db: Database, conversationId: TypeId<"conversation">) =>
  db
    .select(tagFields)
    .from(conversationTagAssignments)
    .innerJoin(
      conversationTags,
      eq(conversationTags.id, conversationTagAssignments.conversationTagId),
    )
    .where(
      and(
        eq(conversationTagAssignments.conversationId, conversationId),
        isNull(conversationTags.deletedAt),
      ),
    )
    .orderBy(asc(conversationTags.name));

const assignmentResult = z.object({
  conversationId: z.string(),
  changed: z.boolean(),
  tags: z.array(tag),
});
const assignmentEvent = (
  { params }: { params: { conversationId: string } },
  result: { changed: boolean },
) =>
  result.changed && {
    type: "conversation.tags_changed" as const,
    entityType: "conversation" as const,
    entityId: params.conversationId,
  };

const addTag = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/tags",
  operationId: "addQuillsConversationTag",
  summary: "Tag a conversation",
  description:
    "Idempotent. The tag must be live. To tag with a new name, create the tag first.",
  action: "update",
  params: conversationParams,
  body: z.object({ tagId: flexibleToTypeIdSchema("conversation_tag") }),
  response: assignmentResult,
  responseDescription: "The conversation's tags",
  errors,
  event: assignmentEvent,
  handler: async ({ db, params, body }) => {
    const conversation = await findConversation(db, params.conversationId);
    const tagId = await resolveLiveTag(db, body.tagId);
    const changed = await attachTag(db, conversation, tagId);
    return {
      conversationId: conversation.id,
      changed,
      tags: await tagsOf(db, conversation.id),
    };
  },
});

const removeTag = defineQuillsRoute({
  method: "delete",
  path: "/conversations/{conversationId}/tags/{tagId}",
  operationId: "removeQuillsConversationTag",
  summary: "Remove a tag from a conversation",
  description: "Idempotent. The tag must exist in this workspace.",
  action: "update",
  params: conversationParams.extend(tagParams.shape),
  response: assignmentResult,
  responseDescription: "The conversation's tags",
  errors,
  event: assignmentEvent,
  handler: async ({ db, params }) => {
    const conversation = await findConversation(db, params.conversationId);
    const current = await findTag(db, params.tagId);
    const removed = await db
      .delete(conversationTagAssignments)
      .where(
        and(
          eq(conversationTagAssignments.conversationId, conversation.id),
          eq(conversationTagAssignments.conversationTagId, current.id),
        ),
      )
      .returning({ id: conversationTagAssignments.conversationTagId });
    return {
      conversationId: conversation.id,
      changed: removed.length > 0,
      tags: await tagsOf(db, conversation.id),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listTags)
  .openapi(...tagUsage)
  .openapi(...createTag)
  .openapi(...updateTag)
  .openapi(...archiveTag)
  .openapi(...restoreTag)
  .openapi(...deleteTag)
  .openapi(...addTag)
  .openapi(...removeTag);
