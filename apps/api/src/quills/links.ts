import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../openapi";
import {
  boardProjects,
  postTasks,
} from "../database/quills/schema/platform-links";
import { boards } from "../database/quills/schema/boards";
import { posts } from "../database/quills/schema/posts";
import { defineQuillsRoute } from "./framework/define-route";
import { taskProjectId, visibleLinks } from "./framework/platform-reads";

const native = { project: ["read"] };
const shared = {
  action: "update" as const,
  native,
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Link updated",
  errors: { 404: "Resource not found" },
};

const boardLink = <M extends "put" | "delete">(method: M) =>
  defineQuillsRoute({
    ...shared,
    method,
    path: "/boards/{boardId}/projects/{projectId}",
    operationId:
      method === "put"
        ? "linkQuillsBoardToProject"
        : "unlinkQuillsBoardFromProject",
    summary:
      method === "put"
        ? "Link a Quills board to a project"
        : "Unlink a Quills board from a project",
    params: z.object({
      boardId: flexibleToTypeIdSchema("board"),
      projectId: z.string().min(1),
    }),
    project: ({ params }) => params.projectId,
    event: ({ params }, result) =>
      result.changed && {
        type:
          method === "put" ? "board.project_linked" : "board.project_unlinked",
        entityType: "board",
        entityId: params.boardId,
        payload: { projectId: params.projectId },
      },
    handler: async ({ db, params }) => {
      const [board] = await db
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, params.boardId), isNull(boards.deletedAt)))
        .limit(1);
      if (!board) throw new HTTPException(404, { message: "Board not found" });
      const rows =
        method === "put"
          ? await db
              .insert(boardProjects)
              .values({ boardId: params.boardId, projectId: params.projectId })
              .onConflictDoNothing()
              .returning({ id: boardProjects.boardId })
          : await db
              .delete(boardProjects)
              .where(
                and(
                  eq(boardProjects.boardId, params.boardId),
                  eq(boardProjects.projectId, params.projectId),
                ),
              )
              .returning({ id: boardProjects.boardId });
      return { changed: rows.length > 0 };
    },
  });

const postLink = <M extends "put" | "delete">(method: M) =>
  defineQuillsRoute({
    ...shared,
    method,
    path: "/posts/{postId}/tasks/{taskId}",
    operationId:
      method === "put" ? "linkQuillsPostToTask" : "unlinkQuillsPostFromTask",
    summary:
      method === "put"
        ? "Link a Quills post to a task"
        : "Unlink a Quills post from a task",
    params: z.object({
      postId: flexibleToTypeIdSchema("post"),
      taskId: z.string().min(1),
    }),
    // The task's stored project, never a project ID from the caller.
    project: ({ params, workspaceId }) =>
      taskProjectId(workspaceId, params.taskId),
    event: ({ params }, result) =>
      result.changed && {
        type: method === "put" ? "post.task_linked" : "post.task_unlinked",
        entityType: "post",
        entityId: params.postId,
        payload: { taskId: params.taskId },
      },
    handler: async ({ db, params }) => {
      const [post] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, params.postId), isNull(posts.deletedAt)))
        .limit(1);
      if (!post) throw new HTTPException(404, { message: "Post not found" });
      const rows =
        method === "put"
          ? await db
              .insert(postTasks)
              .values({ postId: params.postId, taskId: params.taskId })
              .onConflictDoNothing()
              .returning({ id: postTasks.postId })
          : await db
              .delete(postTasks)
              .where(
                and(
                  eq(postTasks.postId, params.postId),
                  eq(postTasks.taskId, params.taskId),
                ),
              )
              .returning({ id: postTasks.postId });
      return { changed: rows.length > 0 };
    },
  });

const listLinks = defineQuillsRoute({
  method: "get",
  path: "/links",
  operationId: "listQuillsLinks",
  summary: "List visible Quills board and post links",
  action: "read",
  native,
  query: z.object({
    offset: z.coerce.number().int().min(0).max(10000000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  }),
  response: z.object({
    nextOffset: z.number().nullable(),
    boards: z.array(z.object({ boardId: z.string(), projectId: z.string() })),
    posts: z.array(z.object({ postId: z.string(), taskId: z.string() })),
  }),
  responseDescription: "Visible product links",
  errors: { 404: "Resource not found" },
  // One extra row per list tells visibleLinks whether a next page exists.
  handler: async ({ db, query: { offset, limit } }) => ({
    nextOffset: null,
    boards: await db
      .select({
        boardId: boardProjects.boardId,
        projectId: boardProjects.projectId,
      })
      .from(boardProjects)
      .orderBy(boardProjects.boardId, boardProjects.projectId)
      .offset(offset)
      .limit(limit + 1),
    posts: await db
      .select({ postId: postTasks.postId, taskId: postTasks.taskId })
      .from(postTasks)
      .orderBy(postTasks.postId, postTasks.taskId)
      .offset(offset)
      .limit(limit + 1),
  }),
  // Visibility reads public tables, so it runs after the scoped transaction.
  after: (page, { query, workspaceId, userId }) =>
    visibleLinks(page, query, workspaceId, userId),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...boardLink("put"))
  .openapi(...boardLink("delete"))
  .openapi(...postLink("put"))
  .openapi(...postLink("delete"))
  .openapi(...listLinks);
