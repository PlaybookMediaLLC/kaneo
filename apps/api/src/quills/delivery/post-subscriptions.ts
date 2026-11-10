import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { postVotes } from "../../database/quills/schema/posts";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { findPost, loadProjects } from "../feedback/visibility";

// A teammate's own subscription needs only `read`: it changes what is sent to them, not the post.
const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const level = z.enum(["all", "status_only"]);
const flags = (value: z.infer<typeof level>) => ({
  notifyComments: value === "all",
  notifyStatusChanges: true,
});
const status = z.object({
  level: z.enum(["all", "status_only", "none"]),
  reason: z.string().nullable(),
});
const errors = { 403: "Insufficient permission", 404: "Post not found" };
const personal = {
  none: "The caller's own subscription; no shared record changes.",
};

const subscription = (postId: PostId, principalId: PrincipalId) =>
  and(
    eq(postSubscriptions.postId, postId),
    eq(postSubscriptions.principalId, principalId),
  );

/** Creates the row with `reason`, or changes the level of an existing one. */
async function setLevel(
  db: Database,
  postId: PostId,
  principalId: PrincipalId,
  value: z.infer<typeof level>,
  reason: string,
) {
  await db
    .insert(postSubscriptions)
    .values({ postId, principalId, reason, ...flags(value) })
    .onConflictDoUpdate({
      target: [
        postSubscriptions.workspaceId,
        postSubscriptions.postId,
        postSubscriptions.principalId,
      ],
      set: { ...flags(value), updatedAt: new Date() },
    });
}

const getSubscription = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/subscription",
  operationId: "getQuillsPostSubscription",
  summary: "Get the caller's subscription to a Quills post",
  action: "read",
  params: postParams,
  response: status,
  responseDescription: "The caller's subscription level",
  errors,
  load: loadProjects,
  handler: async ({ db, actor, params, loaded }) => {
    await findPost(db, params.postId, loaded);
    const [row] = await db
      .select({
        notifyComments: postSubscriptions.notifyComments,
        notifyStatusChanges: postSubscriptions.notifyStatusChanges,
        reason: postSubscriptions.reason,
      })
      .from(postSubscriptions)
      .where(subscription(params.postId, actor.principalId));
    return {
      level: !row?.notifyStatusChanges
        ? ("none" as const)
        : row.notifyComments
          ? ("all" as const)
          : ("status_only" as const),
      reason: row?.reason ?? null,
    };
  },
});

const subscribe = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/subscription",
  operationId: "setQuillsPostSubscription",
  summary: "Subscribe the caller to a Quills post or change the level",
  action: "read",
  params: postParams,
  body: z.object({ level }),
  response: z.object({ level }),
  responseDescription: "The caller's subscription level",
  errors,
  event: personal,
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded }) => {
    await findPost(db, params.postId, loaded);
    await setLevel(db, params.postId, actor.principalId, body.level, "manual");
    return { level: body.level };
  },
});

const unsubscribe = defineQuillsRoute({
  method: "delete",
  path: "/posts/{postId}/subscription",
  operationId: "deleteQuillsPostSubscription",
  summary: "Unsubscribe the caller from a Quills post",
  action: "read",
  params: postParams,
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether a subscription was removed",
  errors,
  event: personal,
  load: loadProjects,
  handler: async ({ db, actor, params, loaded }) => {
    await findPost(db, params.postId, loaded);
    const rows = await db
      .delete(postSubscriptions)
      .where(subscription(params.postId, actor.principalId))
      .returning({ id: postSubscriptions.id });
    return { changed: rows.length > 0 };
  },
});

const setVoterSubscription = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/subscribers/{principalId}",
  operationId: "setQuillsVoterSubscription",
  summary: "Set a voter's subscription to a Quills post",
  description: "Only for a principal who voted on this post.",
  action: "update",
  params: postParams.extend({
    principalId: flexibleToTypeIdSchema("principal"),
  }),
  body: z.object({ level: z.enum(["all", "status_only", "none"]) }),
  response: z.object({ level: z.enum(["all", "status_only", "none"]) }),
  responseDescription: "The voter's subscription level",
  errors: { ...errors, 404: "Post or vote not found" },
  event: ({ params, body }) => ({
    type: "post.subscription_changed",
    entityType: "post",
    entityId: params.postId,
    payload: { principalId: params.principalId, level: body.level },
  }),
  load: loadProjects,
  handler: async ({ db, params, body, loaded }) => {
    await findPost(db, params.postId, loaded);
    const [vote] = await db
      .select({ id: postVotes.id })
      .from(postVotes)
      .where(
        and(
          eq(postVotes.postId, params.postId),
          eq(postVotes.principalId, params.principalId),
        ),
      );
    if (!vote) throw new HTTPException(404, { message: "Vote not found" });
    if (body.level === "none")
      await db
        .delete(postSubscriptions)
        .where(subscription(params.postId, params.principalId));
    else
      await setLevel(db, params.postId, params.principalId, body.level, "vote");
    return { level: body.level };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getSubscription)
  .openapi(...subscribe)
  .openapi(...unsubscribe)
  .openapi(...setVoterSubscription);
