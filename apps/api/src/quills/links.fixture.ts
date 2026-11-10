import { projectTable, taskTable } from "../database/schema";
import { boards } from "../database/quills/schema/boards";
import {
  boardProjects,
  postTasks,
} from "../database/quills/schema/platform-links";
import { posts } from "../database/quills/schema/posts";
import { postStatuses } from "../database/quills/schema/statuses";
import { fixture, type ContractEnv } from "./framework/contract";

/** A project, task, board and post in one workspace. */
async function side(env: ContractEnv, workspaceId: string) {
  const projectId = env.id("project"),
    taskId = env.id("task");
  await env.db
    .insert(projectTable)
    .values({ id: projectId, workspaceId, name: "Contract", slug: projectId });
  await env.db
    .insert(taskTable)
    .values({ id: taskId, projectId, title: "Contract", number: 1 });
  return env.scoped(workspaceId, async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Contract", slug: env.id("board") })
      .returning({ id: boards.id });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .limit(1);
    const [post] = await db
      .insert(posts)
      .values({
        title: "Contract",
        content: "Contract",
        boardId: board!.id,
        principalId: actor.principalId,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    return { projectId, taskId, boardId: board!.id, postId: post!.id };
  });
}

/** Both workspaces, with A's board and post already linked when `linked` is set. */
async function seed(env: ContractEnv, linked: boolean) {
  const a = await side(env, env.a),
    b = await side(env, env.b);
  if (linked)
    await env.scoped(env.a, async (db) => {
      await db
        .insert(boardProjects)
        .values({ boardId: a.boardId, projectId: a.projectId });
      await db.insert(postTasks).values({ postId: a.postId, taskId: a.taskId });
    });
  return { a, b };
}
type Ids = Awaited<ReturnType<typeof seed>>;

const boardLink = (linked: boolean) =>
  fixture({
    seed: (env) => seed(env, linked),
    valid: ({ a }: Ids) => ({
      params: { boardId: a.boardId, projectId: a.projectId },
    }),
    foreign: ({ b }: Ids) => ({ boardId: b.boardId, projectId: b.projectId }),
  });
const postLink = (linked: boolean) =>
  fixture({
    seed: (env) => seed(env, linked),
    valid: ({ a }: Ids) => ({ params: { postId: a.postId, taskId: a.taskId } }),
    foreign: ({ b }: Ids) => ({ postId: b.postId, taskId: b.taskId }),
  });

export const linkQuillsBoardToProject = boardLink(false);
export const unlinkQuillsBoardFromProject = boardLink(true);
export const linkQuillsPostToTask = postLink(false);
export const unlinkQuillsPostFromTask = postLink(true);
export const listQuillsLinks = fixture({
  seed: (env) => seed(env, true),
  valid: () => ({}),
});
