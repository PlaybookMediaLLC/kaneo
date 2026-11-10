import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { postActivity } from "../../database/quills/schema/activity";
import { principal } from "../../database/quills/schema/auth";
import { boards, postTags } from "../../database/quills/schema/boards";
import { boardProjects } from "../../database/quills/schema/platform-links";
import {
  postCommentReactions,
  postComments,
  posts,
  postTagAssignments,
  postVotes,
} from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import * as kaneo from "../../database/schema";
import { startFeature } from "./harness.fixture";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
let world: Awaited<ReturnType<typeof startFeature>>;
// Boards: hidden = linked only to the private project, open = linked to the open project,
// both = linked to both, plain = no link, gone = soft-deleted. One post on each, plus a
// test-customer post, a deleted post and a merged post on the plain board. Tag T is on the
// hidden post and the test post only.
let ids: {
  hidden: TypeId<"board">;
  open: TypeId<"board">;
  both: TypeId<"board">;
  plain: TypeId<"board">;
  gone: TypeId<"board">;
  hiddenPost: TypeId<"post">;
  hiddenComment: TypeId<"post_comment">;
  openPost: TypeId<"post">;
  bothPost: TypeId<"post">;
  plainPost: TypeId<"post">;
  gonePost: TypeId<"post">;
  testPost: TypeId<"post">;
  deletedPost: TypeId<"post">;
  mergedPost: TypeId<"post">;
  tag: TypeId<"post_tag">;
  status: TypeId<"post_status">;
  owner: TypeId<"principal">;
};

describe.skipIf(!url)("Feedback visibility", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "visibility");
    const { a, users, projects } = world;
    ids = await world.scoped(a, users.owner, async (db, actor) => {
      const board = async (label: string) =>
        (
          await db
            .insert(boards)
            .values({ name: label, slug: `${label}-${Date.now()}` })
            .returning({ id: boards.id })
        )[0]!.id;
      const hidden = await board("hidden");
      const open = await board("open");
      const both = await board("both");
      const plain = await board("plain");
      const gone = await board("gone");
      await db.insert(boardProjects).values([
        { boardId: hidden, projectId: projects.hidden },
        { boardId: open, projectId: projects.open },
        { boardId: both, projectId: projects.hidden },
        { boardId: both, projectId: projects.open },
      ]);
      await db
        .update(boards)
        .set({ deletedAt: new Date() })
        .where(eq(boards.id, gone));
      const [tester] = await db
        .insert(principal)
        .values({
          type: "user",
          role: "user",
          displayName: "Test customer",
          createdAt: new Date(),
          testOwnerPrincipalId: actor.principalId,
        })
        .returning({ id: principal.id });
      const post = async (boardId: TypeId<"board">, extra = {}) =>
        (
          await db
            .insert(posts)
            .values({
              title: "Visibility",
              content: "Visibility",
              boardId,
              principalId: actor.principalId,
              ...extra,
            })
            .returning({ id: posts.id })
        )[0]!.id;
      const hiddenPost = await post(hidden);
      const plainPost = await post(plain);
      const testPost = await post(plain, { principalId: tester!.id });
      const [comment] = await db
        .insert(postComments)
        .values({
          postId: hiddenPost,
          principalId: actor.principalId,
          content: "Hidden",
          isTeamMember: true,
        })
        .returning({ id: postComments.id });
      const [tag] = await db
        .insert(postTags)
        .values({ name: `visibility-${Date.now()}` })
        .returning({ id: postTags.id });
      await db.insert(postTagAssignments).values([
        { postId: hiddenPost, tagId: tag!.id },
        { postId: testPost, tagId: tag!.id },
      ]);
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .limit(1);
      return {
        hidden,
        open,
        both,
        plain,
        gone,
        hiddenPost,
        hiddenComment: comment!.id,
        openPost: await post(open),
        bothPost: await post(both),
        plainPost,
        gonePost: await post(gone),
        testPost,
        deletedPost: await post(plain, { deletedAt: new Date() }),
        mergedPost: await post(plain, { canonicalPostId: plainPost }),
        tag: tag!.id,
        status: status!.id,
        owner: actor.principalId,
      };
    });
  }, 120000);
  afterAll(() => world?.stop());

  const list = async (user: string, path: string) =>
    (
      (await world.request(user, "GET", path)).body.items as { id: string }[]
    ).map((item) => item.id);

  /** Every row a hidden-board request could touch, as one comparable value. */
  const hiddenRows = () =>
    world.scoped(world.a, world.users.owner, async (db) =>
      JSON.stringify([
        await db.select().from(boards).where(eq(boards.id, ids.hidden)),
        await db
          .select()
          .from(boardProjects)
          .where(eq(boardProjects.boardId, ids.hidden)),
        await db.select().from(posts).where(eq(posts.id, ids.hiddenPost)),
        await db
          .select()
          .from(postComments)
          .where(eq(postComments.postId, ids.hiddenPost)),
        await db
          .select()
          .from(postVotes)
          .where(eq(postVotes.postId, ids.hiddenPost)),
        await db
          .select()
          .from(postActivity)
          .where(eq(postActivity.postId, ids.hiddenPost)),
        await db
          .select()
          .from(postTagAssignments)
          .where(eq(postTagAssignments.postId, ids.hiddenPost)),
        await db
          .select()
          .from(postCommentReactions)
          .where(inArray(postCommentReactions.commentId, [ids.hiddenComment])),
      ]),
    );

  it("hides a board whose only links are to projects the caller cannot open", async () => {
    const { owner, member } = world.users;
    const memberBoards = await list(member, "/boards");
    // One link to an open project is enough.
    expect(memberBoards).toEqual(
      expect.arrayContaining([ids.open, ids.both, ids.plain]),
    );
    expect(memberBoards).not.toContain(ids.hidden);
    expect(memberBoards).not.toContain(ids.gone);
    expect(
      (await world.request(member, "GET", `/boards/${ids.hidden}`)).status,
    ).toBe(404);
    expect(
      (await world.request(member, "GET", `/boards/${ids.both}`)).status,
    ).toBe(200);
    expect(
      (await world.request(owner, "GET", `/boards/${ids.hidden}`)).status,
    ).toBe(200);
    expect(
      (await world.request(owner, "GET", `/boards/${ids.gone}`)).status,
    ).toBe(404);
  });

  it("refuses to link a hidden board to a project the caller can open", async () => {
    const { member } = world.users;
    const links = () =>
      world.scoped(world.a, world.users.owner, (db) =>
        db
          .select({ projectId: boardProjects.projectId })
          .from(boardProjects)
          .where(eq(boardProjects.boardId, ids.hidden)),
      );
    const before = await links();
    const path = `/boards/${ids.hidden}/projects/${world.projects.open}`;
    expect((await world.request(member, "PUT", path)).status).toBe(404);
    expect((await world.request(member, "DELETE", path)).status).toBe(404);
    expect(await links()).toEqual(before);
    expect(
      (await world.request(member, "GET", `/boards/${ids.hidden}`)).status,
    ).toBe(404);
  });

  it("hides posts and comments of hidden boards in lists and reads", async () => {
    const { owner, member } = world.users;
    const memberPosts = await list(member, "/posts?limit=100");
    expect(memberPosts).toEqual(
      expect.arrayContaining([ids.openPost, ids.bothPost, ids.plainPost]),
    );
    for (const id of [
      ids.hiddenPost,
      ids.gonePost,
      ids.testPost,
      ids.deletedPost,
      ids.mergedPost,
    ])
      expect(memberPosts).not.toContain(id);
    expect(await list(owner, "/posts?limit=100")).toContain(ids.hiddenPost);
    expect(await list(member, `/posts?boardIds=${ids.hidden}`)).toEqual([]);
    for (const path of [
      `/posts/${ids.hiddenPost}`,
      `/posts/${ids.hiddenPost}/comments`,
      `/posts/${ids.hiddenPost}/voters`,
      `/posts/${ids.hiddenPost}/activity`,
      `/comments/${ids.hiddenComment}`,
      // A hidden post is not a cursor either, so it cannot probe the post's place.
      `/posts?sort=votes&cursor=${ids.hiddenPost}`,
    ])
      expect((await world.request(member, "GET", path)).status, path).toBe(404);
  });

  it("denies every mutation on a hidden board's rows and changes nothing", async () => {
    const { member } = world.users;
    const post = `/posts/${ids.hiddenPost}`;
    const comment = `/comments/${ids.hiddenComment}`;
    const requests: [string, string, unknown?][] = [
      ["PATCH", `/boards/${ids.hidden}`, { name: "No" }],
      ["DELETE", `/boards/${ids.hidden}`],
      ["POST", "/posts", { boardId: ids.hidden, title: "No" }],
      ["PATCH", post, { title: "No" }],
      ["PUT", `${post}/status`, { statusId: ids.status }],
      ["PUT", `${post}/board`, { boardId: ids.plain }],
      ["PUT", `/posts/${ids.openPost}/board`, { boardId: ids.hidden }],
      ["PUT", `${post}/owner`, { ownerPrincipalId: null }],
      ["PUT", `${post}/tags`, { tagIds: [] }],
      ["DELETE", post],
      ["POST", `${post}/restore`],
      ["PUT", `${post}/vote`],
      ["PUT", `${post}/voters/${ids.owner}`],
      ["DELETE", `${post}/voters/${ids.owner}`],
      ["POST", `${post}/comments`, { content: "No" }],
      ["PATCH", comment, { content: "No" }],
      ["DELETE", comment],
      ["POST", `${comment}/restore`],
      ["PUT", `${post}/pinned-comment/${ids.hiddenComment}`],
      ["DELETE", `${post}/pinned-comment/${ids.hiddenComment}`],
      ["PUT", `${comment}/reactions?emoji=%F0%9F%91%8D`],
      ["DELETE", `${comment}/reactions?emoji=%F0%9F%91%8D`],
    ];
    const before = await hiddenRows();
    for (const [method, path, body] of requests)
      expect(
        (await world.request(member, method, path, body)).status,
        `${method} ${path}`,
      ).toBe(404);
    expect(await hiddenRows()).toBe(before);
  });

  it("lets a restricted member write on a board of a project they can open", async () => {
    const { member } = world.users;
    const created = await world.request(member, "POST", "/posts", {
      boardId: ids.both,
      title: "Allowed",
    });
    expect(created.status).toBe(200);
    const moved = await world.request(
      member,
      "PUT",
      `/posts/${created.body.id}/board`,
      { boardId: ids.open },
    );
    expect(moved.status).toBe(200);
    expect(moved.body.boardId).toBe(ids.open);
  });

  it("leaves hidden, deleted, merged and test-customer posts out of counts", async () => {
    const { owner, member } = world.users;
    const counts = (await world.request(member, "GET", "/posts/counts")).body;
    const boardIds = counts.boards.map((row: { id: string }) => row.id);
    expect(boardIds).not.toContain(ids.hidden);
    expect(boardIds).not.toContain(ids.gone);
    expect(
      counts.boards.find((row: { id: string }) => row.id === ids.plain)?.count,
    ).toBe(1);
    // Tag T is only on the hidden post and the test post.
    expect(counts.tags.map((row: { id: string }) => row.id)).not.toContain(
      ids.tag,
    );
    expect(
      (await world.request(owner, "GET", "/posts/counts")).body.tags.find(
        (row: { id: string }) => row.id === ids.tag,
      )?.count,
    ).toBe(1);
    const withCounts = (
      await world.request(owner, "GET", "/boards?counts=true")
    ).body.items;
    expect(
      withCounts.find((row: { id: string }) => row.id === ids.plain)?.postCount,
    ).toBe(1);
  });

  it("deletes and restores a post in both directions", async () => {
    const { owner } = world.users;
    const path = `/posts/${ids.openPost}`;
    expect((await world.request(owner, "DELETE", path)).status).toBe(200);
    expect((await world.request(owner, "GET", path)).status).toBe(404);
    expect(await list(owner, "/posts?limit=100")).not.toContain(ids.openPost);
    expect(await list(owner, "/posts?limit=100&showDeleted=true")).toContain(
      ids.openPost,
    );
    expect((await world.request(owner, "DELETE", path)).status).toBe(404);
    expect((await world.request(owner, "POST", `${path}/restore`)).status).toBe(
      200,
    );
    expect((await world.request(owner, "GET", path)).status).toBe(200);
    expect((await world.request(owner, "POST", `${path}/restore`)).status).toBe(
      409,
    );
  });

  it("works with the link routes for boards and posts made through the new routes", async () => {
    const { owner, member } = world.users;
    const board = await world.request(owner, "POST", "/boards", {
      name: "Linked board",
    });
    expect(board.status).toBe(200);
    expect(
      (
        await world.request(
          owner,
          "PUT",
          `/boards/${board.body.id}/projects/${world.projects.hidden}`,
        )
      ).body,
    ).toEqual({ changed: true });
    expect(
      (await world.request(member, "GET", `/boards/${board.body.id}`)).status,
    ).toBe(404);

    const post = await world.request(owner, "POST", "/posts", {
      boardId: ids.open,
      title: "Linked post",
      tagIds: [ids.tag],
    });
    expect(
      (
        await world.request(
          owner,
          "PUT",
          `/posts/${post.body.id}/tasks/${world.taskId}`,
        )
      ).body,
    ).toEqual({ changed: true });
    const customer = await world.scoped(world.a, owner, async (db) => {
      const [row] = await db
        .insert(principal)
        .values({ type: "user", role: "user", createdAt: new Date() })
        .returning({ id: principal.id });
      return row!.id;
    });
    const path = `/posts/${post.body.id}`;
    await world.request(owner, "PUT", `${path}/voters/${customer}`);
    await world.request(owner, "POST", `${path}/comments`, { content: "Hi" });
    await world.request(owner, "PUT", `${path}/status`, {
      statusId: ids.status,
    });
    const detail = (await world.request(owner, "GET", path)).body;
    expect(detail).toMatchObject({
      voteCount: 2,
      commentCount: 1,
      statusId: ids.status,
      hasVoted: true,
    });
    expect(detail.tags.map((tag: { id: string }) => tag.id)).toEqual([ids.tag]);

    const links = async () =>
      (await world.request(owner, "GET", "/links")).body;
    expect((await links()).boards).toContainEqual({
      boardId: board.body.id,
      projectId: world.projects.hidden,
    });
    expect((await links()).posts).toContainEqual({
      postId: post.body.id,
      taskId: world.taskId,
    });
    // A deleted board drops its links, so no listed link points at a board nobody can open.
    expect(
      (await world.request(owner, "DELETE", `/boards/${board.body.id}`)).status,
    ).toBe(200);
    expect(
      (await links()).boards.map((link: { boardId: string }) => link.boardId),
    ).not.toContain(board.body.id);
  });
});
