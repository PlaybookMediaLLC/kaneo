import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  ASSISTANT_SNIPPET_AUDIENCES,
  assistantSnippets,
} from "../../database/quills/schema/assistant";
import { someField } from "../feedback/schemas";
import { defineQuillsRoute, type Database } from "../framework/define-route";

// Snippets: short facts the assistant grounds answers on (the copilot's search_knowledge tool,
// and public snippets for the widget).

const MAX_SNIPPETS = 500;
const params = z.object({
  snippetId: flexibleToTypeIdSchema("assistant_snippet"),
});
const snippetSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  audience: z.enum(ASSISTANT_SNIPPET_AUDIENCES),
  enabled: z.boolean(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
const columns = {
  id: assistantSnippets.id,
  title: assistantSnippets.title,
  content: assistantSnippets.content,
  audience: assistantSnippets.audience,
  enabled: assistantSnippets.enabled,
  createdAt: assistantSnippets.createdAt,
  updatedAt: assistantSnippets.updatedAt,
};
const fields = {
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(2000),
  audience: z.enum(ASSISTANT_SNIPPET_AUDIENCES),
  enabled: z.boolean(),
};
const errors = { 404: "Snippet not found" };
type SnippetId = z.output<typeof params>["snippetId"];

async function findSnippet(db: Database, id: SnippetId) {
  const [row] = await db
    .select({ id: assistantSnippets.id })
    .from(assistantSnippets)
    .where(eq(assistantSnippets.id, id))
    .for("update");
  if (!row) throw new HTTPException(404, { message: "Snippet not found" });
}

const listSnippets = defineQuillsRoute({
  method: "get",
  path: "/assistant/snippets",
  operationId: "listQuillsSnippets",
  summary: "List the assistant snippets",
  description: "Newest first.",
  action: "manage_settings",
  query: z.object({ enabled: z.enum(["true", "false"]).optional() }),
  response: z.object({ items: z.array(snippetSchema) }),
  responseDescription: "The snippets",
  handler: async ({ db, query }) => ({
    items: await db
      .select(columns)
      .from(assistantSnippets)
      .where(
        query.enabled &&
          eq(assistantSnippets.enabled, query.enabled === "true"),
      )
      .orderBy(desc(assistantSnippets.createdAt))
      .limit(MAX_SNIPPETS),
  }),
});

const createSnippet = defineQuillsRoute({
  method: "post",
  path: "/assistant/snippets",
  operationId: "createQuillsSnippet",
  summary: "Create an assistant snippet",
  description: `A workspace has at most ${MAX_SNIPPETS} snippets.`,
  action: "manage_settings",
  body: z.object({
    ...fields,
    audience: fields.audience.default("team"),
    enabled: fields.enabled.default(true),
  }),
  response: snippetSchema,
  responseDescription: "The new snippet",
  errors: { 409: `A workspace has at most ${MAX_SNIPPETS} snippets` },
  event: (_input, snippet) => ({
    type: "assistant_snippet.created",
    entityType: "assistant_snippet",
    entityId: snippet.id,
  }),
  handler: async ({ db, actor, body }) => {
    if ((await db.$count(assistantSnippets)) >= MAX_SNIPPETS)
      throw new HTTPException(409, {
        message: `A workspace has at most ${MAX_SNIPPETS} snippets`,
      });
    const [row] = await db
      .insert(assistantSnippets)
      .values({
        title: body.title,
        content: body.content,
        audience: body.audience,
        enabled: body.enabled,
        createdById: actor.principalId,
      })
      .returning(columns);
    return row!;
  },
});

const updateSnippet = defineQuillsRoute({
  method: "patch",
  path: "/assistant/snippets/{snippetId}",
  operationId: "updateQuillsSnippet",
  summary: "Update an assistant snippet",
  description: "A new title or content clears a stored (imported) embedding.",
  action: "manage_settings",
  params,
  body: z
    .object({
      title: fields.title.optional(),
      content: fields.content.optional(),
      audience: fields.audience.optional(),
      enabled: fields.enabled.optional(),
    })
    .refine(someField, {
      message: "Change at least one field",
    }),
  response: snippetSchema,
  responseDescription: "The updated snippet",
  errors,
  event: ({ params }) => ({
    type: "assistant_snippet.updated",
    entityType: "assistant_snippet",
    entityId: params.snippetId,
  }),
  handler: async ({ db, params, body }) => {
    await findSnippet(db, params.snippetId);
    const text = body.title !== undefined || body.content !== undefined;
    const [row] = await db
      .update(assistantSnippets)
      .set({
        title: body.title,
        content: body.content,
        audience: body.audience,
        enabled: body.enabled,
        ...(text && {
          embedding: null,
          embeddingModel: null,
          embeddingUpdatedAt: null,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(assistantSnippets.id, params.snippetId)))
      .returning(columns);
    return row!;
  },
});

const deleteSnippet = defineQuillsRoute({
  method: "delete",
  path: "/assistant/snippets/{snippetId}",
  operationId: "deleteQuillsSnippet",
  summary: "Delete an assistant snippet",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted snippet's ID",
  errors,
  event: ({ params }) => ({
    type: "assistant_snippet.deleted",
    entityType: "assistant_snippet",
    entityId: params.snippetId,
  }),
  handler: async ({ db, params }) => {
    await findSnippet(db, params.snippetId);
    await db
      .delete(assistantSnippets)
      .where(eq(assistantSnippets.id, params.snippetId));
    return { id: params.snippetId };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listSnippets)
  .openapi(...createSnippet)
  .openapi(...updateSnippet)
  .openapi(...deleteSnippet);
