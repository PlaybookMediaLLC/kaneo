import { desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { postExternalLinks as links } from "../../database/quills/schema/external-links";
import { posts } from "../../database/quills/schema/posts";
import { defineQuillsRoute } from "../framework/define-route";
import { findPost, loadHidden } from "../feedback/visibility";
import { httpsUrl } from "./catalog";

const params = z.object({ postId: flexibleToTypeIdSchema("post") });
const errors = { 403: "Insufficient permission", 404: "Post not found" };

const listLinks = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/external-links",
  operationId: "listQuillsPostExternalLinks",
  summary: "List the external items linked to a post",
  action: "read",
  params,
  load: loadHidden,
  response: z.object({
    links: z.array(
      z.object({
        id: z.string(),
        integrationType: z.string(),
        externalId: z.string(),
        externalDisplayId: z.string().nullable(),
        externalUrl: z.string().nullable(),
        status: z.string(),
        remoteTitle: z.string().nullable(),
        remoteState: z.string().nullable(),
        origin: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  responseDescription: "Linked external items, newest first (at most 100)",
  errors,
  handler: async ({ db, params, loaded: hidden }) => {
    await findPost(db, params.postId, hidden);
    const rows = await db
      .select({
        id: links.id,
        integrationType: links.integrationType,
        externalId: links.externalId,
        externalDisplayId: links.externalDisplayId,
        externalUrl: links.externalUrl,
        status: links.status,
        remoteTitle: links.remoteTitle,
        remoteState: links.remoteState,
        origin: links.origin,
        createdAt: links.createdAt,
      })
      .from(links)
      .where(eq(links.postId, params.postId))
      .orderBy(desc(links.createdAt))
      .limit(100);
    return {
      links: rows.map((row) => ({
        ...row,
        externalUrl: httpsUrl(row.externalUrl),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  },
});

const resyncPost = defineQuillsRoute({
  method: "post",
  path: "/posts/{postId}/integration-sync",
  operationId: "retryQuillsPostIntegrationSync",
  summary: "Queue a post's integration deliveries again",
  description:
    "Queues the post's create delivery for each mapped destination that has none, after this request commits. A destination that already has one keeps it; use sync recovery for it. Does not replay webhooks, mail or notifications.",
  action: "manage_settings",
  params,
  load: loadHidden,
  response: z.object({ requested: z.boolean() }),
  responseDescription: "Resync requested",
  errors: { ...errors, 409: "Only published posts can be synced" },
  event: ({ params }) => ({
    type: "post.integration_sync_requested",
    entityType: "post",
    entityId: params.postId,
  }),
  handler: async ({ db, params, loaded: hidden }) => {
    await findPost(db, params.postId, hidden);
    const [post] = await db
      .select({ moderationState: posts.moderationState })
      .from(posts)
      .where(eq(posts.id, params.postId));
    if (post?.moderationState !== "published")
      throw new HTTPException(409, {
        message: "Only published posts can be synced",
      });
    return { requested: true };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listLinks)
  .openapi(...resyncPost);
