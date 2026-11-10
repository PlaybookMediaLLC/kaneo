import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import platformDb from "../../database";
import { projectTable, taskTable, teamTable } from "../../database/schema";
import { findInaccessibleProjectIds } from "../../project-access/find-inaccessible-project-ids";

// The only module that reads public tables for Quills routes. Every read filters on workspaceId.

/** The task's stored project. 404 when the task is not in this workspace. */
export async function taskProjectId(workspaceId: string, taskId: string) {
  const [task] = await platformDb
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(eq(taskTable.id, taskId), eq(projectTable.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!task?.projectId)
    throw new HTTPException(404, { message: "Task not found" });
  return task.projectId;
}

/** A Kaneo team of this workspace. 404 otherwise. */
export async function canonicalTeam(workspaceId: string, id: string) {
  const [team] = await platformDb
    .select({ id: teamTable.id, name: teamTable.name })
    .from(teamTable)
    .where(and(eq(teamTable.id, id), eq(teamTable.workspaceId, workspaceId)))
    .limit(1);
  if (!team) throw new HTTPException(404, { message: "Team not found" });
  return team;
}

type Links = {
  nextOffset: number | null;
  boards: { boardId: string; projectId: string }[];
  posts: { postId: string; taskId: string }[];
};

/**
 * Trims a page read with one extra row per list, then removes links whose project
 * or task left this workspace or is hidden from the user.
 */
export async function visibleLinks(
  rows: Links,
  { offset, limit }: { offset: number; limit: number },
  workspaceId: string,
  userId: string,
): Promise<Links> {
  const page = {
    nextOffset:
      rows.boards.length > limit || rows.posts.length > limit
        ? offset + limit
        : null,
    boards: rows.boards.slice(0, limit),
    posts: rows.posts.slice(0, limit),
  };
  const taskIds = [...new Set(page.posts.map((p) => p.taskId))];
  const tasks = taskIds.length
    ? await platformDb
        .select({ id: taskTable.id, projectId: taskTable.projectId })
        .from(taskTable)
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(
          and(
            inArray(taskTable.id, taskIds),
            eq(projectTable.workspaceId, workspaceId),
          ),
        )
    : [];
  const projectIds = [...new Set(page.boards.map((b) => b.projectId))];
  const projects = projectIds.length
    ? await platformDb
        .select({ id: projectTable.id })
        .from(projectTable)
        .where(
          and(
            inArray(projectTable.id, projectIds),
            eq(projectTable.workspaceId, workspaceId),
          ),
        )
    : [];
  const present = new Set(projects.map((p) => p.id));
  const denied = new Set(
    await findInaccessibleProjectIds(userId, [
      ...page.boards.map((b) => b.projectId),
      ...tasks.flatMap((t) => (t.projectId ? [t.projectId] : [])),
    ]),
  );
  const allowedTasks = new Set(
    tasks
      .filter((t) => t.projectId && !denied.has(t.projectId))
      .map((t) => t.id),
  );
  return {
    nextOffset: page.nextOffset,
    boards: page.boards.filter(
      (b) => present.has(b.projectId) && !denied.has(b.projectId),
    ),
    posts: page.posts.filter((p) => allowedTasks.has(p.taskId)),
  };
}
