import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PrincipalId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { inAppNotifications } from "../../database/quills/schema/notifications";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { openProjectIds, seesBoard } from "../framework/platform-reads";

// The caller's own inbox. `read` is enough: a viewer manages the notifications sent to them, and nobody else's.
const personal = {
  none: "The caller's own inbox state; no shared record changes.",
};
const params = z.object({
  notificationId: flexibleToTypeIdSchema("notification"),
});
const notification = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    postId: z.string().nullable(),
    commentId: z.string().nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
    post: z.object({ id: z.string(), title: z.string() }).nullable(),
  })
  .openapi("QuillsNotification");
const changed = z.object({ changed: z.boolean() });
const counted = z.object({ count: z.number() });
const notFound = { 404: "Notification not found" };
const mine = (principalId: PrincipalId) =>
  and(
    eq(inAppNotifications.principalId, principalId),
    isNull(inAppNotifications.archivedAt),
  );

const listNotifications = defineQuillsRoute({
  method: "get",
  path: "/notifications",
  operationId: "listQuillsNotifications",
  summary: "List the caller's Quills notifications",
  description:
    "A notification about a post the caller can no longer see keeps its row but hides its text and links.",
  action: "read",
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    unreadOnly: z.enum(["true", "false"]).default("false"),
  }),
  response: z.object({
    notifications: z.array(notification),
    total: z.number(),
    unreadCount: z.number(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of notifications, newest first",
  errors: { 403: "Insufficient permission" },
  // Read before the transaction, so a request never holds two pool connections.
  load: ({ workspaceId, userId }) => openProjectIds(workspaceId, userId),
  handler: async ({ db, actor, query, loaded }) => {
    const where =
      query.unreadOnly === "true"
        ? and(mine(actor.principalId), isNull(inAppNotifications.readAt))
        : mine(actor.principalId);
    const rows = await db
      .select({
        id: inAppNotifications.id,
        type: inAppNotifications.type,
        title: inAppNotifications.title,
        body: inAppNotifications.body,
        postId: inAppNotifications.postId,
        commentId: inAppNotifications.commentId,
        readAt: inAppNotifications.readAt,
        createdAt: inAppNotifications.createdAt,
        postTitle: posts.title,
        boardId: posts.boardId,
      })
      .from(inAppNotifications)
      .leftJoin(
        posts,
        and(eq(posts.id, inAppNotifications.postId), isNull(posts.deletedAt)),
      )
      .where(where)
      .orderBy(desc(inAppNotifications.createdAt), desc(inAppNotifications.id))
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await db
      .select({ n: count() })
      .from(inAppNotifications)
      .where(where);
    const [unread] = await db
      .select({ n: count() })
      .from(inAppNotifications)
      .where(and(mine(actor.principalId), isNull(inAppNotifications.readAt)));
    const hidden = await hiddenBoards(
      db,
      loaded,
      rows.flatMap((row) => (row.boardId ? [row.boardId] : [])),
    );
    return {
      notifications: rows.map((row) => {
        const denied =
          row.postId !== null &&
          (!row.boardId || hidden.has(row.boardId) || !row.postTitle);
        return {
          id: row.id,
          type: row.type,
          title: denied ? "Notification" : row.title,
          body: denied
            ? "This activity is no longer visible to you."
            : row.body,
          postId: denied ? null : row.postId,
          commentId: denied ? null : row.commentId,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          post:
            denied || !row.postId
              ? null
              : { id: row.postId, title: row.postTitle! },
        };
      }),
      total: total!.n,
      unreadCount: unread!.n,
      hasMore: query.offset + rows.length < total!.n,
    };
  },
});

/** Boards that are linked only to projects the user cannot open. */
async function hiddenBoards(
  db: Database,
  open: Set<string>,
  boardIds: (typeof boardProjects.$inferSelect.boardId)[],
) {
  const unique = [...new Set(boardIds)];
  const links = unique.length
    ? await db
        .select({
          boardId: boardProjects.boardId,
          projectId: boardProjects.projectId,
        })
        .from(boardProjects)
        .where(inArray(boardProjects.boardId, unique))
    : [];
  const hidden = new Set<string>();
  for (const boardId of unique)
    if (
      !seesBoard(
        open,
        links
          .filter((link) => link.boardId === boardId)
          .map((link) => link.projectId),
      )
    )
      hidden.add(boardId);
  return hidden;
}

const unreadCount = defineQuillsRoute({
  method: "get",
  path: "/notifications/unread-count",
  operationId: "getQuillsNotificationUnreadCount",
  summary: "Count the caller's unread Quills notifications",
  action: "read",
  response: counted,
  responseDescription: "Unread notifications that are not archived",
  errors: { 403: "Insufficient permission" },
  handler: async ({ db, actor }) => {
    const [row] = await db
      .select({ n: count() })
      .from(inAppNotifications)
      .where(and(mine(actor.principalId), isNull(inAppNotifications.readAt)));
    return { count: row!.n };
  },
});

/** Sets one notification's timestamp when it is still empty. 404 when the caller does not own it. */
const setOne = <Path extends string>(
  column: "readAt" | "archivedAt",
  operationId: string,
  path: Path,
  summary: string,
) =>
  defineQuillsRoute({
    method: "post",
    path,
    operationId,
    summary,
    action: "read",
    params,
    response: changed,
    responseDescription: "Whether the notification changed",
    errors: notFound,
    event: personal,
    handler: async ({ db, actor, params }) => {
      const own = and(
        eq(inAppNotifications.id, params.notificationId),
        eq(inAppNotifications.principalId, actor.principalId),
      );
      const rows = await db
        .update(inAppNotifications)
        .set({ [column]: new Date() })
        .where(and(own, isNull(inAppNotifications[column])))
        .returning({ id: inAppNotifications.id });
      if (rows.length) return { changed: true };
      const [row] = await db
        .select({ id: inAppNotifications.id })
        .from(inAppNotifications)
        .where(own);
      if (!row)
        throw new HTTPException(404, { message: "Notification not found" });
      return { changed: false };
    },
  });

const markRead = setOne(
  "readAt",
  "markQuillsNotificationRead",
  "/notifications/{notificationId}/read",
  "Mark one of the caller's Quills notifications as read",
);
const archive = setOne(
  "archivedAt",
  "archiveQuillsNotification",
  "/notifications/{notificationId}/archive",
  "Archive one of the caller's Quills notifications",
);

const markAllRead = defineQuillsRoute({
  method: "post",
  path: "/notifications/read-all",
  operationId: "markQuillsAllNotificationsRead",
  summary: "Mark all of the caller's Quills notifications as read",
  action: "read",
  response: counted,
  responseDescription: "Notifications marked as read",
  errors: { 403: "Insufficient permission" },
  event: personal,
  handler: async ({ db, actor }) => ({
    count:
      (
        await db
          .update(inAppNotifications)
          .set({ readAt: new Date() })
          .where(
            and(mine(actor.principalId), isNull(inAppNotifications.readAt)),
          )
      ).rowCount ?? 0,
  }),
});

const archiveRead = defineQuillsRoute({
  method: "post",
  path: "/notifications/archive-read",
  operationId: "archiveQuillsReadNotifications",
  summary: "Archive the caller's read Quills notifications",
  action: "read",
  response: counted,
  responseDescription: "Notifications archived",
  errors: { 403: "Insufficient permission" },
  event: personal,
  handler: async ({ db, actor }) => ({
    count:
      (
        await db
          .update(inAppNotifications)
          .set({ archivedAt: new Date() })
          .where(
            and(mine(actor.principalId), isNotNull(inAppNotifications.readAt)),
          )
      ).rowCount ?? 0,
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listNotifications)
  .openapi(...unreadCount)
  .openapi(...markRead)
  .openapi(...archive)
  .openapi(...markAllRead)
  .openapi(...archiveRead);
