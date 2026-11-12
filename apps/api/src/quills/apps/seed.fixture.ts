import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createId } from "@kaneo/ids";
import { projectTable } from "../../database/schema";
import { apps } from "../../database/quills/schema/apps";
import { boards } from "../../database/quills/schema/boards";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import type { ContractEnv } from "../framework/contract";

// Seed helpers for the app route fixtures and feature tests. Not fixtures themselves.

/** A word that no other post holds, so full-text search finds only the seeded post. */
const word = () =>
  `zq${[...randomBytes(8)].map((byte) => String.fromCharCode(97 + (byte % 26))).join("")}`;

/**
 * A board linked to a fresh project, so that a caller who cannot open the project cannot see it, with
 * one post. The post's title is a unique word, it has an embedding, and many votes, so it ranks first
 * among equally similar posts. An app link to `key` (type zendesk) is on the post.
 */
export async function appSide(
  env: ContractEnv,
  workspaceId: string,
  boardName?: string,
) {
  const projectId = env.id("project");
  await env.db
    .insert(projectTable)
    .values({ id: projectId, workspaceId, name: projectId, slug: projectId });
  const title = word();
  const key = env.id("ticket");
  return env.scoped(workspaceId, async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: boardName ?? `App ${title}`, slug: env.id("board") })
      .returning({ id: boards.id });
    await db.insert(boardProjects).values({ boardId: board!.id, projectId });
    const [post] = await db
      .insert(posts)
      .values({
        title,
        content: title,
        boardId: board!.id,
        principalId: actor.principalId,
        voteCount: 1000000,
      })
      .returning({ id: posts.id });
    await db
      .update(posts)
      .set({
        embedding: sql`array_fill(0.01::real, ARRAY[1536])::vector` as never,
      })
      .where(eq(posts.id, post!.id));
    await db.insert(postExternalLinks).values({
      postId: post!.id,
      integrationType: "zendesk",
      externalId: key,
      origin: "sidebar",
    });
    return { projectId, boardId: board!.id, postId: post!.id, title, key };
  });
}

export const appSeed = async (env: ContractEnv) => ({
  a: await appSide(env, env.a),
  b: await appSide(env, env.b),
});
export type AppIds = Awaited<ReturnType<typeof appSeed>>;

/** A registered app in one workspace, bound to a key ID that no key has. */
export const registeredApp = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(apps)
      .values({
        id: createId("app"),
        name: env.id("app"),
        apiKeyId: env.id("unused_key"),
        grantedScopes: ["read:feedback"],
      })
      .returning({ id: apps.id });
    return row!.id;
  });
