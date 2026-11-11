import { desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { assistantWebSources } from "../../database/quills/schema/assistant-web-sources";
import { defineQuillsRoute } from "../framework/define-route";

// Web sources: public pages the assistant grounds answers on. The route stores the URL; a worker
// fetches the page through Kaneo's public-destination guard after commit
// (assistant_web_source.added) and stores its text.

const MAX_SOURCES = 100;
const params = z.object({
  webSourceId: flexibleToTypeIdSchema("assistant_web_source"),
});
const sourceSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  enabled: z.boolean(),
  /** pending until the worker fetched the page; failed when it could not. */
  status: z.enum(["pending", "ready", "failed"]),
  characters: z.number(),
  fetchedAt: responseTimestamp,
  createdAt: responseTimestamp,
});
const columns = {
  id: assistantWebSources.id,
  url: assistantWebSources.url,
  title: assistantWebSources.title,
  enabled: assistantWebSources.enabled,
  status: sql<
    "pending" | "ready" | "failed"
  >`CASE WHEN ${assistantWebSources.content} <> '' THEN 'ready' WHEN ${assistantWebSources.fetchedAt} > ${assistantWebSources.createdAt} THEN 'failed' ELSE 'pending' END`,
  characters: sql<number>`char_length(${assistantWebSources.content})::int`,
  fetchedAt: assistantWebSources.fetchedAt,
  createdAt: assistantWebSources.createdAt,
};
const notFound = () =>
  new HTTPException(404, { message: "Web source not found" });

/** An http(s) URL without credentials. The worker checks the address it resolves to. */
const pageUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "Enter an http or https URL without credentials")
  .transform((value) => {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  });

const listSources = defineQuillsRoute({
  method: "get",
  path: "/assistant/web-sources",
  operationId: "listQuillsWebSources",
  summary: "List the assistant web sources",
  action: "manage_settings",
  response: z.object({ items: z.array(sourceSchema) }),
  responseDescription: "The web sources, newest first",
  handler: async ({ db }) => ({
    items: await db
      .select(columns)
      .from(assistantWebSources)
      .orderBy(desc(assistantWebSources.createdAt))
      .limit(MAX_SOURCES),
  }),
});

const addSource = defineQuillsRoute({
  method: "post",
  path: "/assistant/web-sources",
  operationId: "addQuillsWebSource",
  summary: "Add a public web page as an assistant source",
  description:
    "Returns the source as pending. A worker fetches the page after commit; a page that resolves to a private address, needs sign-in or is not text fails.",
  action: "manage_settings",
  body: z.object({ url: pageUrl }),
  response: sourceSchema,
  responseDescription: "The new source",
  errors: { 409: "This URL is already a source, or the limit is reached" },
  event: (_input, source) => ({
    type: "assistant_web_source.added",
    entityType: "assistant_web_source",
    entityId: source.id,
  }),
  handler: async ({ db, actor, body }) => {
    if ((await db.$count(assistantWebSources)) >= MAX_SOURCES)
      throw new HTTPException(409, {
        message: `A workspace has at most ${MAX_SOURCES} web sources`,
      });
    const now = new Date();
    const [row] = await db
      .insert(assistantWebSources)
      .values({
        url: body.url,
        title: new URL(body.url).hostname,
        content: "",
        fetchedAt: now,
        createdAt: now,
        createdById: actor.principalId,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row)
      throw new HTTPException(409, {
        message: "This URL is already a source",
      });
    return row;
  },
});

const setEnabled = defineQuillsRoute({
  method: "patch",
  path: "/assistant/web-sources/{webSourceId}",
  operationId: "setQuillsWebSourceEnabled",
  summary: "Turn an assistant web source on or off",
  action: "manage_settings",
  params,
  body: z.object({ enabled: z.boolean() }),
  response: sourceSchema,
  responseDescription: "The updated source",
  errors: { 404: "Web source not found" },
  event: ({ params, body }) => ({
    type: "assistant_web_source.updated",
    entityType: "assistant_web_source",
    entityId: params.webSourceId,
    payload: { enabled: String(body.enabled) },
  }),
  handler: async ({ db, params, body }) => {
    const [row] = await db
      .update(assistantWebSources)
      .set({ enabled: body.enabled, updatedAt: new Date() })
      .where(eq(assistantWebSources.id, params.webSourceId))
      .returning(columns);
    if (!row) throw notFound();
    return row;
  },
});

const deleteSource = defineQuillsRoute({
  method: "delete",
  path: "/assistant/web-sources/{webSourceId}",
  operationId: "deleteQuillsWebSource",
  summary: "Delete an assistant web source",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted source's ID",
  errors: { 404: "Web source not found" },
  event: ({ params }) => ({
    type: "assistant_web_source.deleted",
    entityType: "assistant_web_source",
    entityId: params.webSourceId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .delete(assistantWebSources)
      .where(eq(assistantWebSources.id, params.webSourceId))
      .returning({ id: assistantWebSources.id });
    if (!row) throw notFound();
    return { id: row.id };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listSources)
  .openapi(...addSource)
  .openapi(...setEnabled)
  .openapi(...deleteSource);
