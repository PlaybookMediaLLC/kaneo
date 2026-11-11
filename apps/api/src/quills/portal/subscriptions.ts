import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isValidTypeId, type PostId, type SegmentId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { posts } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import type { QuillsCaller } from "../framework/audience";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { requirePortalAccess } from "./gate";

// A portal customer's own subscriptions: posts, the changelog and the status page. Each route
// changes only the caller's own row, so it records no outbox event (as the teammate twins in
// delivery/post-subscriptions.ts). Every route needs the portal on and the caller let in.

const personal = {
  none: "The caller's own subscription; no shared record changes.",
};
const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });

/**
 * 404 unless the caller may see the post on the portal: a live, published post that was not
 * merged, on a live board whose view tier lets customers in.
 *
 * ponytail: the public-feedback slice owns the full portal visibility rule; this is its
 * conservative core (a segment tier needs the caller in one of the board's view segments).
 */
async function customerPost(
  db: Database,
  caller: QuillsCaller,
  postId: PostId,
) {
  const [row] = await db
    .select({ access: boards.access })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(
      and(
        eq(posts.id, postId),
        isNull(posts.deletedAt),
        isNull(posts.canonicalPostId),
        eq(posts.moderationState, "published"),
        isNull(boards.deletedAt),
      ),
    )
    .limit(1);
  const view = row?.access?.view;
  if (view === "anonymous" || view === "authenticated") return;
  const allowed = (row?.access?.segments?.view ?? [])
    .filter((id): id is SegmentId => isValidTypeId(id, "segment"))
    .slice(0, 100);
  if (view === "segments" && caller.principalId && allowed.length) {
    const [member] = await db
      .select({ id: userSegments.segmentId })
      .from(userSegments)
      .innerJoin(segments, eq(segments.id, userSegments.segmentId))
      .where(
        and(
          eq(userSegments.principalId, caller.principalId),
          inArray(userSegments.segmentId, allowed),
          isNull(segments.deletedAt),
        ),
      )
      .limit(1);
    if (member) return;
  }
  throw notFound("Post");
}

const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const level = z.enum(["all", "status_only"]);
const mine = (postId: PostId, caller: QuillsCaller) =>
  and(
    eq(postSubscriptions.postId, postId),
    eq(postSubscriptions.principalId, caller.principalId!),
  );

const getPostSubscription = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/posts/{postId}/subscription",
  operationId: "getQuillsMyPostSubscription",
  summary: "Get the caller's subscription to a post",
  description: "level is none for a caller without a sign-in or a profile.",
  action: "read",
  params: postParams,
  response: z.object({ level: z.enum(["all", "status_only", "none"]) }),
  responseDescription: "The caller's subscription level",
  errors: { 403: "Portal access denied", 404: "Post or portal not found" },
  handler: async ({ db, caller, params }) => {
    await requirePortalAccess(db, caller);
    await customerPost(db, caller, params.postId);
    const [row] = caller.principalId
      ? await db
          .select({
            notifyComments: postSubscriptions.notifyComments,
            notifyStatusChanges: postSubscriptions.notifyStatusChanges,
          })
          .from(postSubscriptions)
          .where(mine(params.postId, caller))
      : [];
    return {
      level: !row?.notifyStatusChanges
        ? ("none" as const)
        : row.notifyComments
          ? ("all" as const)
          : ("status_only" as const),
    };
  },
});

const setPostSubscription = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "put",
  path: "/posts/{postId}/subscription",
  operationId: "setQuillsMyPostSubscription",
  summary: "Subscribe the caller to a post or change the level",
  action: "update",
  rateLimit: { limit: 60, windowSeconds: 600 },
  params: postParams,
  body: z.object({ level }),
  response: z.object({ level }),
  responseDescription: "The caller's subscription level",
  errors: { 403: "Portal access denied", 404: "Post or portal not found" },
  event: personal,
  handler: async ({ db, caller, params, body }) => {
    await requirePortalAccess(db, caller);
    await customerPost(db, caller, params.postId);
    const flags = {
      notifyComments: body.level === "all",
      notifyStatusChanges: true,
    };
    await db
      .insert(postSubscriptions)
      .values({
        postId: params.postId,
        principalId: caller.principalId!,
        reason: "manual",
        ...flags,
      })
      .onConflictDoUpdate({
        target: [
          postSubscriptions.workspaceId,
          postSubscriptions.postId,
          postSubscriptions.principalId,
        ],
        set: { ...flags, updatedAt: new Date() },
      });
    return { level: body.level };
  },
});

const deletePostSubscription = defineQuillsRoute({
  audience: "portal",
  method: "delete",
  path: "/posts/{postId}/subscription",
  operationId: "deleteQuillsMyPostSubscription",
  summary: "Unsubscribe the caller from a post",
  action: "update",
  params: postParams,
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether a subscription was removed",
  errors: { 403: "Portal access denied", 404: "Post or portal not found" },
  event: personal,
  handler: async ({ db, caller, params }) => {
    await requirePortalAccess(db, caller);
    await customerPost(db, caller, params.postId);
    if (!caller.principalId) return { changed: false };
    const rows = await db
      .delete(postSubscriptions)
      .where(mine(params.postId, caller))
      .returning({ id: postSubscriptions.id });
    return { changed: rows.length > 0 };
  },
});

const changelogSubscription = (caller: QuillsCaller) =>
  eq(changelogSubscriptions.principalId, caller.principalId!);

const getChangelogSubscription = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/changelog/subscription",
  operationId: "getQuillsMyChangelogSubscription",
  summary: "Get the caller's changelog subscription",
  action: "read",
  response: z.object({ subscribed: z.boolean() }),
  responseDescription: "Whether the caller hears about new changelog entries",
  errors: { 403: "Portal access denied", 404: "Portal not found" },
  handler: async ({ db, caller }) => {
    await requirePortalAccess(db, caller);
    const [row] = caller.principalId
      ? await db
          .select({ unsubscribedAt: changelogSubscriptions.unsubscribedAt })
          .from(changelogSubscriptions)
          .where(changelogSubscription(caller))
      : [];
    return { subscribed: Boolean(row && !row.unsubscribedAt) };
  },
});

const subscribeChangelog = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "put",
  path: "/changelog/subscription",
  operationId: "subscribeQuillsMyChangelog",
  summary: "Subscribe the caller to the changelog",
  description: "An explicit subscribe also undoes an earlier unsubscribe.",
  action: "update",
  rateLimit: { limit: 30, windowSeconds: 600 },
  response: z.object({ subscribed: z.boolean() }),
  responseDescription: "The caller is subscribed",
  errors: { 403: "Portal access denied", 404: "Portal not found" },
  event: personal,
  handler: async ({ db, caller }) => {
    await requirePortalAccess(db, caller);
    await db
      .insert(changelogSubscriptions)
      .values({ principalId: caller.principalId!, source: "self_serve" })
      .onConflictDoUpdate({
        target: [
          changelogSubscriptions.workspaceId,
          changelogSubscriptions.principalId,
        ],
        set: { unsubscribedAt: null },
      });
    return { subscribed: true };
  },
});

const unsubscribeChangelog = defineQuillsRoute({
  audience: "portal",
  method: "delete",
  path: "/changelog/subscription",
  operationId: "unsubscribeQuillsMyChangelog",
  summary: "Unsubscribe the caller from the changelog",
  description:
    "Keeps the row, so an import or auto-subscribe never subscribes the caller again.",
  action: "update",
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether a subscription ended",
  errors: { 403: "Portal access denied", 404: "Portal not found" },
  event: personal,
  handler: async ({ db, caller }) => {
    await requirePortalAccess(db, caller);
    if (!caller.principalId) return { changed: false };
    const rows = await db
      .update(changelogSubscriptions)
      .set({ unsubscribedAt: new Date() })
      .where(
        and(
          changelogSubscription(caller),
          isNull(changelogSubscriptions.unsubscribedAt),
        ),
      )
      .returning({ id: changelogSubscriptions.id });
    return { changed: rows.length > 0 };
  },
});

export default apiRouter()
  .openapi(...getPostSubscription)
  .openapi(...setPostSubscription)
  .openapi(...deletePostSubscription)
  .openapi(...getChangelogSubscription)
  .openapi(...subscribeChangelog)
  .openapi(...unsubscribeChangelog);
