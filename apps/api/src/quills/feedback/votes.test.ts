import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { posts, postVotes } from "../../database/quills/schema/posts";
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
let boardId: TypeId<"board">;

/** A fresh post with no votes, and `n` customers (or test customers) of A. */
async function setup(n: number, test = false) {
  return world.scoped(world.a, world.users.owner, async (db, actor) => {
    const [post] = await db
      .insert(posts)
      .values({
        title: "Votes",
        content: "Votes",
        boardId,
        principalId: actor.principalId,
      })
      .returning({ id: posts.id });
    const people = n
      ? await db
          .insert(principal)
          .values(
            Array.from({ length: n }, (_, i) => ({
              type: "user",
              role: "user",
              displayName: `Voter ${i}`,
              createdAt: new Date(),
              testOwnerPrincipalId: test ? actor.principalId : null,
            })),
          )
          .returning({ id: principal.id })
      : [];
    return { postId: post!.id, people: people.map((p) => p.id) };
  });
}
const stored = (postId: TypeId<"post">) =>
  world.scoped(world.a, world.users.owner, async (db) => {
    const [post] = await db
      .select({ voteCount: posts.voteCount })
      .from(posts)
      .where(eq(posts.id, postId));
    const [rows] = await db
      .select({ n: count() })
      .from(postVotes)
      .where(eq(postVotes.postId, postId));
    return { voteCount: post!.voteCount, rows: rows!.n };
  });

describe.skipIf(!url)("Feedback votes", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "votes");
    boardId = await world.scoped(world.a, world.users.owner, async (db) => {
      const [board] = await db
        .insert(boards)
        .values({ name: "Votes", slug: `votes-${Date.now()}` })
        .returning({ id: boards.id });
      return board!.id;
    });
  }, 120000);
  afterAll(() => world?.stop());

  it("counts parallel votes of different people exactly", async () => {
    const { postId, people } = await setup(12);
    const results = await Promise.all(
      people.map((id) =>
        world.request(
          world.users.owner,
          "PUT",
          `/posts/${postId}/voters/${id}`,
        ),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(people.map(() => 200));
    expect(await stored(postId)).toEqual({ voteCount: 12, rows: 12 });
  });

  it("keeps one vote for parallel votes of the same person", async () => {
    const { postId } = await setup(0);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        world.request(world.users.member, "PUT", `/posts/${postId}/vote`),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(results.map(() => 200));
    expect(results.filter((r) => r.body.changed)).toHaveLength(1);
    expect(results.map((r) => r.body.voteCount)).toEqual(results.map(() => 1));
    expect(await stored(postId)).toEqual({ voteCount: 1, rows: 1 });
  });

  it("adds and removes a proxy vote idempotently, with activity", async () => {
    const { postId, people } = await setup(1);
    const path = `/posts/${postId}/voters/${people[0]}`;
    const owner = world.users.owner;
    expect((await world.request(owner, "PUT", path)).body).toMatchObject({
      changed: true,
      voteCount: 1,
    });
    expect((await world.request(owner, "PUT", path)).body).toMatchObject({
      changed: false,
      voteCount: 1,
    });
    const voters = (
      await world.request(owner, "GET", `/posts/${postId}/voters`)
    ).body.items;
    expect(voters).toHaveLength(1);
    expect(voters[0]).toMatchObject({
      principalId: people[0],
      sourceType: "proxy",
    });
    expect((await world.request(owner, "DELETE", path)).body).toMatchObject({
      changed: true,
      voteCount: 0,
    });
    expect((await world.request(owner, "DELETE", path)).body).toMatchObject({
      changed: false,
      voteCount: 0,
    });
    const activity = (
      await world.request(owner, "GET", `/posts/${postId}/activity`)
    ).body.items;
    expect(activity.map((row: { type: string }) => row.type)).toEqual([
      "vote.removed",
      "vote.proxy",
    ]);
    expect(await stored(postId)).toEqual({ voteCount: 0, rows: 0 });
  });

  it("stores a test customer's vote without counting or listing it", async () => {
    const { postId, people } = await setup(1, true);
    const res = await world.request(
      world.users.owner,
      "PUT",
      `/posts/${postId}/voters/${people[0]}`,
    );
    expect(res.body).toMatchObject({ changed: true, voteCount: 0 });
    expect(await stored(postId)).toEqual({ voteCount: 0, rows: 1 });
    expect(
      (await world.request(world.users.owner, "GET", `/posts/${postId}/voters`))
        .body.items,
    ).toEqual([]);
  });

  it("counts a vote on a merged post on the post it was merged into", async () => {
    const source = await setup(0);
    const canonical = await setup(0);
    await world.scoped(world.a, world.users.owner, (db) =>
      db
        .update(posts)
        .set({ canonicalPostId: canonical.postId })
        .where(eq(posts.id, source.postId)),
    );
    const res = await world.request(
      world.users.member,
      "PUT",
      `/posts/${source.postId}/vote`,
    );
    // The result and its event name the post that holds the vote.
    expect(res.body).toEqual({
      postId: canonical.postId,
      changed: true,
      voteCount: 1,
    });
    expect(await stored(canonical.postId)).toEqual({ voteCount: 1, rows: 1 });
    expect(await stored(source.postId)).toEqual({ voteCount: 0, rows: 0 });
    // Reads of either post see that vote, and a second vote adds nothing.
    for (const postId of [source.postId, canonical.postId]) {
      const read = (path = "") =>
        world.request(world.users.member, "GET", `/posts/${postId}${path}`);
      expect((await read()).body.hasVoted).toBe(true);
      expect((await read("/voters")).body.items).toHaveLength(1);
      expect(
        (
          await world.request(
            world.users.member,
            "PUT",
            `/posts/${postId}/vote`,
          )
        ).body,
      ).toEqual({ postId: canonical.postId, changed: false, voteCount: 1 });
    }
  });

  it("does not show an anonymous voter's name or avatar", async () => {
    const { postId } = await setup(0);
    const anonymous = await world.scoped(
      world.a,
      world.users.owner,
      async (db) => {
        const [row] = await db
          .insert(principal)
          .values({
            type: "anonymous",
            role: "user",
            displayName: "Visitor 42",
            avatarUrl: "https://example.test/a.png",
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        return row!.id;
      },
    );
    await world.request(
      world.users.owner,
      "PUT",
      `/posts/${postId}/voters/${anonymous}`,
    );
    const [voter] = (
      await world.request(world.users.owner, "GET", `/posts/${postId}/voters`)
    ).body.items;
    expect(voter).toMatchObject({
      principalId: anonymous,
      isAnonymous: true,
      displayName: null,
      avatarUrl: null,
    });
  });

  it("does not take a service principal as a voter", async () => {
    const { postId } = await setup(0);
    const service = await world.scoped(
      world.a,
      world.users.owner,
      async (db) => {
        const [row] = await db
          .insert(principal)
          .values({
            type: "service",
            role: "member",
            displayName: "Bot",
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        return row!.id;
      },
    );
    expect(
      (
        await world.request(
          world.users.owner,
          "PUT",
          `/posts/${postId}/voters/${service}`,
        )
      ).status,
    ).toBe(404);
  });
});
