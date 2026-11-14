import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { BoardId, PostTagId, PrincipalId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { boards, postTags } from "../../database/quills/schema/boards";
import {
  posts,
  postTagAssignments,
  postVotes,
} from "../../database/quills/schema/posts";
import { postSentiment } from "../../database/quills/schema/sentiment";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import {
  customer,
  linkedProject,
  removeMembers,
  restrictedMember,
  testCustomer,
} from "./taxonomy-harness.fixture";

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
const app = contractApp(quillsRouter);
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** One post with tags, a sentiment and votes, in a workspace, as its owner. */
async function postWith(
  env: ContractEnv,
  workspaceId: string,
  input: {
    boardId: BoardId;
    createdAt: Date;
    tags?: PostTagId[];
    sentiment?: "positive" | "neutral" | "negative";
    voters?: PrincipalId[];
    author?: PrincipalId;
    deleted?: boolean;
  },
) {
  return env.scoped(workspaceId, async (db, actor) => {
    const [post] = await db
      .insert(posts)
      .values({
        title: "Insight",
        content: "Insight",
        boardId: input.boardId,
        principalId: input.author ?? actor.principalId,
        createdAt: input.createdAt,
        deletedAt: input.deleted ? new Date() : null,
      })
      .returning({ id: posts.id });
    if (input.tags?.length)
      await db
        .insert(postTagAssignments)
        .values(input.tags.map((tagId) => ({ postId: post!.id, tagId })));
    if (input.sentiment)
      await db.insert(postSentiment).values({
        postId: post!.id,
        sentiment: input.sentiment,
        confidence: 0.9,
        model: "test",
      });
    if (input.voters?.length)
      await db.insert(postVotes).values(
        input.voters.map((principalId) => ({
          postId: post!.id,
          principalId,
          createdAt: input.createdAt,
        })),
      );
    return post!.id;
  });
}

const board = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(boards)
      .values({ name: "Insights", slug: env.id("board") })
      .returning({ id: boards.id });
    return row!.id;
  });
const tag = (env: ContractEnv, workspaceId: string, deleted = false) =>
  env.scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(postTags)
      .values({
        name: env.id("tag"),
        deletedAt: deleted ? new Date() : null,
      })
      .returning({ id: postTags.id });
    return row!.id;
  });

/** GET the insights of A as `user`, optionally through an API key with `scope`. */
async function insights(user: string, query = "", scope?: object) {
  const res = await app.request(
    `/quills/${contractEnv().a}/feedback/insights${query}`,
    {
      headers: {
        "x-test-user": user,
        ...(scope && { "x-test-scope": JSON.stringify(scope) }),
      },
    },
  );
  return { status: res.status, body: (await res.json()) as any };
}
const sum = (weeks: { posts: number; votes: number }[]) =>
  weeks.reduce(
    (t, w) => ({ posts: t.posts + w.posts, votes: t.votes + w.votes }),
    {
      posts: 0,
      votes: 0,
    },
  );

describe.skipIf(!url)("Feedback insights", () => {
  let member: string;
  let noRead: string;
  const ids = {} as {
    open: BoardId;
    hidden: BoardId;
    openTag: PostTagId;
    hiddenTag: PostTagId;
    deletedTag: PostTagId;
    foreignTag: PostTagId;
    openPost: string;
    hiddenPost: string;
    oldPost: string;
    foreignPost: string;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    const env = await startContract(pool, url!);
    // The built-in member role holds quills read. This member opens no project.
    member = await restrictedMember(env, []);
    const role = env.id("no_quills");
    await env.db.insert(kaneo.workspaceRoleTable).values({
      workspaceId: env.a,
      role,
      permission: JSON.stringify({ workspace: ["read"], project: ["read"] }),
      createdAt: new Date(),
    });
    noRead = await restrictedMember(env, [], role);

    ids.open = await board(env, env.a);
    ids.hidden = await board(env, env.a);
    await linkedProject(env, ids.hidden);
    ids.openTag = await tag(env, env.a);
    ids.hiddenTag = await tag(env, env.a);
    ids.deletedTag = await tag(env, env.a, true);
    const voters = [await customer(env), await customer(env)];
    const tester = await testCustomer(env);

    ids.openPost = await postWith(env, env.a, {
      boardId: ids.open,
      createdAt: ago(2),
      tags: [ids.openTag, ids.deletedTag],
      sentiment: "positive",
      voters: [...voters, tester],
    });
    ids.hiddenPost = await postWith(env, env.a, {
      boardId: ids.hidden,
      createdAt: ago(2),
      tags: [ids.openTag, ids.hiddenTag],
      sentiment: "negative",
      voters,
    });
    ids.oldPost = await postWith(env, env.a, {
      boardId: ids.open,
      createdAt: ago(200),
      tags: [ids.openTag],
      sentiment: "neutral",
      voters: voters.slice(0, 1),
    });
    // Not counted: a test customer's post and a deleted post.
    await postWith(env, env.a, {
      boardId: ids.open,
      createdAt: ago(2),
      tags: [ids.openTag],
      sentiment: "neutral",
      author: tester,
    });
    await postWith(env, env.a, {
      boardId: ids.open,
      createdAt: ago(2),
      tags: [ids.openTag],
      sentiment: "neutral",
      deleted: true,
    });

    // Workspace B has its own tagged, voted post in the same range.
    const foreignBoard = await board(env, env.b);
    ids.foreignTag = await tag(env, env.b);
    ids.foreignPost = await postWith(env, env.b, {
      boardId: foreignBoard,
      createdAt: ago(2),
      tags: [ids.foreignTag],
      sentiment: "negative",
    });
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  });

  it("counts only the boards that the member can see", async () => {
    const res = await insights(member);
    expect(res.status).toBe(200);
    expect(res.body.from).toBe(utcDay(ago(29)));
    expect(res.body.to).toBe(utcDay(ago(0)));
    expect(res.body.tags).toEqual([
      expect.objectContaining({ id: ids.openTag, count: 1 }),
    ]);
    expect(res.body.sentiment).toEqual({
      positive: 1,
      neutral: 0,
      negative: 0,
    });
    expect(sum(res.body.weeks)).toEqual({ posts: 1, votes: 2 });
    expect(res.body.topPosts).toEqual([
      {
        id: ids.openPost,
        title: "Insight",
        boardName: "Insights",
        newVotes: 2,
      },
    ]);
    const text = JSON.stringify(res.body);
    for (const hidden of [
      ids.hiddenPost,
      ids.hiddenTag,
      ids.deletedTag,
      ids.foreignTag,
      ids.foreignPost,
    ])
      expect(text).not.toContain(hidden);
  });

  it("counts every board for the owner, and never workspace B", async () => {
    const res = await insights(contractEnv().owner);
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([
      expect.objectContaining({ id: ids.openTag, count: 2 }),
      expect.objectContaining({ id: ids.hiddenTag, count: 1 }),
    ]);
    expect(res.body.sentiment).toEqual({
      positive: 1,
      neutral: 0,
      negative: 1,
    });
    expect(sum(res.body.weeks)).toEqual({ posts: 2, votes: 4 });
    expect(res.body.topPosts.map((post: { id: string }) => post.id)).toEqual(
      expect.arrayContaining([ids.openPost, ids.hiddenPost]),
    );
    expect(JSON.stringify(res.body)).not.toContain(ids.foreignTag);
  });

  it("filters by a visible board and hides a board the member cannot see", async () => {
    expect(
      (await insights(contractEnv().owner, `?boardId=${ids.open}`)).body.tags,
    ).toEqual([expect.objectContaining({ id: ids.openTag, count: 1 })]);
    const hidden = await insights(member, `?boardId=${ids.hidden}`);
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain(ids.hiddenTag);
  });

  it("reads a past range and allows at most 180 days", async () => {
    const old = utcDay(ago(200));
    const past = await insights(member, `?from=${old}&to=${utcDay(ago(190))}`);
    expect(past.status).toBe(200);
    expect(past.body.tags).toEqual([
      expect.objectContaining({ id: ids.openTag, count: 1 }),
    ]);
    expect(past.body.sentiment.neutral).toBe(1);
    expect(sum(past.body.weeks)).toEqual({ posts: 1, votes: 1 });

    const longest = await insights(member, `?from=${utcDay(ago(179))}`);
    expect(longest.status).toBe(200);
    expect(longest.body.weeks.length).toBeGreaterThanOrEqual(26);
    expect(longest.body.weeks.length).toBeLessThanOrEqual(27);
    expect((await insights(member, `?from=${utcDay(ago(180))}`)).status).toBe(
      400,
    );
    expect(
      (await insights(member, `?from=${utcDay(ago(1))}&to=${utcDay(ago(2))}`))
        .status,
    ).toBe(400);
  });

  it("denies a member whose role lacks quills read", async () => {
    const res = await insights(noRead);
    expect(res.status).toBe(403);
    expect(res.body.tags).toBeUndefined();
  });

  it("checks the API-key scope", async () => {
    const owner = contractEnv().owner;
    expect(
      (await insights(owner, "", { workspace: ["read"], quills: [] })).status,
    ).toBe(403);
    expect(
      (await insights(owner, "", { workspace: ["read"], quills: ["read"] }))
        .status,
    ).toBe(200);
  });
});
