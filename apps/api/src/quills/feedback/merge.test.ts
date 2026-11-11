import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { postActivity } from "../../database/quills/schema/activity";
import { events } from "../../database/quills/schema/events";
import {
  postComments,
  postVotes,
  posts,
} from "../../database/quills/schema/posts";
import { apiRouter, type BaseVariables } from "../../openapi";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import { buildQuillsRoute } from "../framework/define-route";
import { registry } from "../framework/registry";
import {
  call,
  customer,
  linkedProject,
  removeMembers,
  restrictedMember,
  testCustomer,
} from "./taxonomy-harness.fixture";
import { postIn } from "./seeds.fixture";

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

/** Two posts in A. Voters: one on both, one on each, a test customer on the duplicate. One public comment on the duplicate. */
async function pair(duplicateValues: Parameters<typeof postIn>[2] = {}) {
  const env = contractEnv();
  const canonical = await postIn(env, env.a);
  const duplicate = await postIn(env, env.a, duplicateValues);
  const shared = await customer(env);
  const first = await customer(env);
  const second = await customer(env);
  const tester = await testCustomer(env);
  await env.scoped(env.a, async (db, actor) => {
    await db.insert(postVotes).values([
      { postId: canonical.postId, principalId: shared },
      { postId: canonical.postId, principalId: first },
      { postId: duplicate.postId, principalId: shared },
      { postId: duplicate.postId, principalId: second },
      { postId: duplicate.postId, principalId: tester },
    ]);
    await db.insert(postComments).values({
      postId: duplicate.postId,
      principalId: actor.principalId,
      content: "Me too",
    });
  });
  return {
    canonical: canonical.postId,
    duplicate: duplicate.postId,
    canonicalBoard: canonical.boardId,
    duplicateBoard: duplicate.boardId,
  };
}
/** The canonical post's stored counts. */
const counts = async (id: PostId) => {
  const { voteCount, commentCount } = await state(id);
  return { voteCount, commentCount };
};
const state = (id: PostId) =>
  contractEnv().scoped(contractEnv().a, async (db) => {
    const [row] = await db
      .select({
        canonicalPostId: posts.canonicalPostId,
        voteCount: posts.voteCount,
        commentCount: posts.commentCount,
      })
      .from(posts)
      .where(eq(posts.id, id));
    const activity = await db
      .select({ type: postActivity.type })
      .from(postActivity)
      .where(eq(postActivity.postId, id))
      .orderBy(asc(postActivity.createdAt));
    const outbox = await db
      .select({ type: events.type })
      .from(events)
      .where(eq(events.entityId, id))
      .orderBy(asc(events.id));
    return {
      ...row!,
      activity: activity.map((a) => a.type),
      events: outbox.map((e) => e.type),
    };
  });
const merge = (user: string, duplicate: string, canonicalPostId: string) =>
  call(app, contractEnv(), user, "POST", `/posts/${duplicate}/merge`, {
    canonicalPostId,
  });

describe.skipIf(!url)("Quills post merge", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  });

  it("links the posts, counts each voter once and records activity and one event", async () => {
    const { owner } = contractEnv();
    const { canonical, duplicate } = await pair();
    expect(await merge(owner, duplicate, canonical)).toEqual({
      status: 200,
      body: {
        canonicalPost: { id: canonical, voteCount: 3 },
        duplicatePost: { id: duplicate },
      },
    });
    expect(await state(canonical)).toEqual({
      canonicalPostId: null,
      voteCount: 3,
      commentCount: 1,
      activity: ["post.merged_in"],
      events: [],
    });
    expect(await state(duplicate)).toMatchObject({
      canonicalPostId: canonical,
      activity: ["post.merged_away"],
      events: ["post.merged"],
    });
    const merged = await call(
      app,
      contractEnv(),
      owner,
      "GET",
      `/posts/${canonical}/merged`,
    );
    expect(merged.body.posts).toEqual([
      expect.objectContaining({ id: duplicate, voteCount: 2 }),
    ]);
  });

  it("previews the merged counts and changes nothing", async () => {
    const { owner } = contractEnv();
    const { canonical, duplicate } = await pair();
    const before = await state(canonical);
    const res = await call(
      app,
      contractEnv(),
      owner,
      "GET",
      `/posts/${duplicate}/merge-preview?into=${canonical}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      duplicate: { id: duplicate },
      canonical: { id: canonical },
      mergedVoteCount: 3,
    });
    expect(await state(canonical)).toEqual(before);
  });

  it("unmerge restores the counts of both posts", async () => {
    const { owner } = contractEnv();
    const { canonical, duplicate } = await pair();
    await merge(owner, duplicate, canonical);
    const res = await call(
      app,
      contractEnv(),
      owner,
      "POST",
      `/posts/${duplicate}/unmerge`,
    );
    expect(res).toEqual({
      status: 200,
      body: {
        post: { id: duplicate },
        canonicalPost: { id: canonical, voteCount: 2 },
      },
    });
    expect(await state(canonical)).toMatchObject({
      voteCount: 2,
      commentCount: 0,
      activity: ["post.merged_in", "post.unmerged"],
    });
    expect(await state(duplicate)).toMatchObject({
      canonicalPostId: null,
      voteCount: 2,
      commentCount: 1,
      events: ["post.merged", "post.unmerged"],
    });
  });

  it("rejects self, repeated and chained merges without a change", async () => {
    const { owner } = contractEnv();
    const { canonical, duplicate } = await pair();
    const other = (await postIn(contractEnv(), contractEnv().a)).postId;
    expect((await merge(owner, duplicate, duplicate)).status).toBe(400);
    expect((await merge(owner, duplicate, canonical)).status).toBe(200);
    const merged = await state(duplicate);
    // Already merged; into a merged post; a canonical post with merged posts.
    expect((await merge(owner, duplicate, other)).status).toBe(409);
    expect((await merge(owner, other, duplicate)).status).toBe(409);
    expect((await merge(owner, canonical, other)).status).toBe(409);
    expect(await state(duplicate)).toEqual(merged);
    expect((await state(other)).canonicalPostId).toBeNull();
    expect(
      (await call(app, contractEnv(), owner, "POST", `/posts/${other}/unmerge`))
        .status,
    ).toBe(409);
  });

  it("rolls back the link, counts, activity and event when the request fails after its writes", async () => {
    const env = contractEnv();
    const { canonical, duplicate } = await pair();
    const declared = [...registry.keys()].find(
      (d) => d.operationId === "mergeQuillsPost",
    )!;
    const failing = contractApp(
      apiRouter<BaseVariables & { workspaceId: string }>().openapi(
        ...buildQuillsRoute({
          ...declared,
          handler: async (input) => {
            await declared.handler(input);
            throw new Error("Injected failure after the merge writes");
          },
        }),
      ),
    );
    const before = [await state(canonical), await state(duplicate)];
    const res = await call(
      failing,
      env,
      env.owner,
      "POST",
      `/posts/${duplicate}/merge`,
      { canonicalPostId: canonical },
    );
    expect(res.status).toBe(500);
    expect([await state(canonical), await state(duplicate)]).toEqual(before);
  });

  it("needs both posts in the caller's workspace, visible to the caller and not test data", async () => {
    const env = contractEnv();
    const { canonical, duplicate } = await pair();
    const hidden = await postIn(env, env.a);
    await linkedProject(env, hidden.boardId);
    const foreign = await postIn(env, env.b);
    const tester = await testCustomer(env);
    const testPost = (await postIn(env, env.a, { principalId: tester })).postId;
    const member = await restrictedMember(env, []);
    const before = await state(duplicate);

    expect((await merge(env.owner, duplicate, foreign.postId)).status).toBe(
      404,
    );
    expect((await merge(env.owner, foreign.postId, canonical)).status).toBe(
      404,
    );
    const preview = `/posts/${duplicate}/merge-preview?into=${foreign.postId}`;
    expect((await call(app, env, env.owner, "GET", preview)).status).toBe(404);
    expect((await merge(env.owner, testPost, canonical)).status).toBe(404);
    expect((await merge(member, duplicate, hidden.postId)).status).toBe(404);
    expect((await merge(member, hidden.postId, canonical)).status).toBe(404);
    expect(
      (
        await call(
          app,
          env,
          member,
          "GET",
          `/posts/${duplicate}/merge-preview?into=${hidden.postId}`,
        )
      ).status,
    ).toBe(404);
    expect(await state(duplicate)).toEqual(before);
    expect((await state(hidden.postId)).canonicalPostId).toBeNull();

    // The owner can open every project; the member cannot undo a merge into a hidden post.
    expect((await merge(env.owner, duplicate, hidden.postId)).status).toBe(200);
    expect(
      (await call(app, env, member, "POST", `/posts/${duplicate}/unmerge`))
        .status,
    ).toBe(404);
    expect((await state(duplicate)).canonicalPostId).toBe(hidden.postId);
    expect((await merge(member, canonical, testPost)).status).toBe(404);
  });

  describe("keeps the canonical post's counts when a merged post changes", () => {
    const send = (method: string, path: string, body?: unknown) =>
      call(app, contractEnv(), contractEnv().owner, method, path, body);
    // Merged: three unique voters and one public comment. Without the duplicate: two voters, no comment.
    const merged = { voteCount: 3, commentCount: 1 };
    const alone = { voteCount: 2, commentCount: 0 };
    const mergedPair = async (values?: Parameters<typeof pair>[0]) => {
      const ids = await pair(values);
      expect(
        (await merge(contractEnv().owner, ids.duplicate, ids.canonical)).status,
      ).toBe(200);
      expect(await counts(ids.canonical)).toEqual(merged);
      return ids;
    };

    it("when the merged post is deleted and restored", async () => {
      const { canonical, duplicate } = await mergedPair();
      expect((await send("DELETE", `/posts/${duplicate}`)).status).toBe(200);
      expect(await counts(canonical)).toEqual(alone);
      expect((await send("POST", `/posts/${duplicate}/restore`)).status).toBe(
        200,
      );
      expect(await counts(canonical)).toEqual(merged);
    });

    it("when the merged post's comments are created, deleted and restored", async () => {
      const { canonical, duplicate } = await mergedPair();
      const created = await send("POST", `/posts/${duplicate}/comments`, {
        content: "Same here",
      });
      expect(created.status).toBe(200);
      expect((await counts(canonical)).commentCount).toBe(2);
      const comment = `/comments/${created.body.id}`;
      expect((await send("DELETE", comment)).status).toBe(200);
      expect((await counts(canonical)).commentCount).toBe(1);
      expect((await send("POST", `${comment}/restore`)).status).toBe(200);
      expect((await counts(canonical)).commentCount).toBe(2);
      // An internal comment counts nowhere.
      const internal = await send("POST", `/posts/${duplicate}/comments`, {
        content: "Internal",
        isPrivate: true,
      });
      expect(internal.status).toBe(200);
      expect(await counts(canonical)).toEqual({
        voteCount: 3,
        commentCount: 2,
      });
    });

    it("when a held comment on the merged post is approved", async () => {
      const { canonical, duplicate } = await mergedPair();
      const [held] = await contractEnv().scoped(contractEnv().a, (db, actor) =>
        db
          .insert(postComments)
          .values({
            postId: duplicate,
            principalId: actor.principalId,
            content: "Held",
            moderationState: "pending",
          })
          .returning({ id: postComments.id }),
      );
      expect(await counts(canonical)).toEqual(merged);
      const res = await send(
        "POST",
        `/moderation/comments/${held!.id}/approve`,
      );
      expect(res.status).toBe(200);
      expect((await counts(canonical)).commentCount).toBe(2);
    });

    it("when a held merged post is rejected", async () => {
      const { canonical, duplicate } = await mergedPair({
        moderationState: "pending",
      });
      const res = await send("POST", `/moderation/posts/${duplicate}/reject`, {
        reason: "",
      });
      expect(res.status).toBe(200);
      expect(await counts(canonical)).toEqual(alone);
    });

    it("when the merged post's board is deleted", async () => {
      const { canonical, duplicate, duplicateBoard } = await mergedPair();
      const deleted = await send("DELETE", `/boards/${duplicateBoard}`);
      expect(deleted.status).toBe(200);
      expect(await counts(canonical)).toEqual(alone);
      // Only a post merged into a post on the deleted board is unmerged; this one stays merged.
      expect(deleted.body.unmerged).toEqual([]);
      expect((await state(duplicate)).canonicalPostId).toBe(canonical);
    });

    it("rolls back the delete and the recount together", async () => {
      const env = contractEnv();
      const { canonical, duplicate } = await mergedPair();
      const declared = [...registry.keys()].find(
        (d) => d.operationId === "deleteQuillsPost",
      )!;
      const failing = contractApp(
        apiRouter<BaseVariables & { workspaceId: string }>().openapi(
          ...buildQuillsRoute({
            ...declared,
            handler: async (input) => {
              await declared.handler(input);
              throw new Error("Injected failure after the recount");
            },
          }),
        ),
      );
      const before = [await state(canonical), await state(duplicate)];
      const res = await call(
        failing,
        env,
        env.owner,
        "DELETE",
        `/posts/${duplicate}`,
      );
      expect(res.status).toBe(500);
      // The counts, the activity entry and the event of the delete all roll back.
      expect([await state(canonical), await state(duplicate)]).toEqual(before);
      expect(await counts(canonical)).toEqual(merged);
      // The same request without the failure deletes the post and moves the counts.
      expect((await send("DELETE", `/posts/${duplicate}`)).status).toBe(200);
      expect(await counts(canonical)).toEqual(alone);
    });
  });

  // Owner decision: a board delete unmerges the posts merged into its posts. Before, they stayed
  // merged into a post that no route could reach, so they could not be unmerged or voted on.
  it("unmerges every post merged into a post on a deleted board, in the delete's transaction", async () => {
    const env = contractEnv();
    const { canonical, duplicate, canonicalBoard } = await pair();
    expect((await merge(env.owner, duplicate, canonical)).status).toBe(200);
    const declared = [...registry.keys()].find(
      (d) => d.operationId === "deleteQuillsBoard",
    )!;
    const failing = contractApp(
      apiRouter<BaseVariables & { workspaceId: string }>().openapi(
        ...buildQuillsRoute({
          ...declared,
          handler: async (input) => {
            await declared.handler(input);
            throw new Error("Injected failure after the unmerge");
          },
        }),
      ),
    );
    const before = [await state(canonical), await state(duplicate)];
    expect(
      (
        await call(
          failing,
          env,
          env.owner,
          "DELETE",
          `/boards/${canonicalBoard}`,
        )
      ).status,
    ).toBe(500);
    expect([await state(canonical), await state(duplicate)]).toEqual(before);

    const deleted = await call(
      app,
      env,
      env.owner,
      "DELETE",
      `/boards/${canonicalBoard}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.unmerged).toEqual([
      { postId: duplicate, canonicalPostId: canonical },
    ]);
    expect(await state(duplicate)).toMatchObject({
      canonicalPostId: null,
      voteCount: 2,
      commentCount: 1,
      activity: ["post.merged_away", "post.unmerged"],
      events: ["post.merged", "post.unmerged"],
    });
    expect(await state(canonical)).toMatchObject({
      voteCount: 2,
      commentCount: 0,
      activity: ["post.merged_in", "post.unmerged"],
    });
    // Independent again: there is nothing left to unmerge, and nothing changes.
    const after = await state(duplicate);
    expect(
      (await call(app, env, env.owner, "POST", `/posts/${duplicate}/unmerge`))
        .status,
    ).toBe(409);
    expect(await state(duplicate)).toEqual(after);
  });

  it("also unmerges from a deleted canonical post on the deleted board", async () => {
    const env = contractEnv();
    const { canonical, duplicate, canonicalBoard } = await pair();
    expect((await merge(env.owner, duplicate, canonical)).status).toBe(200);
    const send = (method: string, path: string) =>
      call(app, env, env.owner, method, path);
    expect((await send("DELETE", `/posts/${canonical}`)).status).toBe(200);
    const deleted = await send("DELETE", `/boards/${canonicalBoard}`);
    expect(deleted.body.unmerged).toEqual([
      { postId: duplicate, canonicalPostId: canonical },
    ]);
    expect(await state(duplicate)).toMatchObject({
      canonicalPostId: null,
      voteCount: 2,
    });
  });

  it("unmerges a post the caller cannot see without naming it", async () => {
    const env = contractEnv();
    const { canonical, duplicate, canonicalBoard, duplicateBoard } =
      await pair();
    await linkedProject(env, duplicateBoard);
    expect((await merge(env.owner, duplicate, canonical)).status).toBe(200);
    // An administrator who can open no linked project still sees the canonical post's board.
    const admin = await restrictedMember(env, [], "admin");
    const deleted = await call(
      app,
      env,
      admin,
      "DELETE",
      `/boards/${canonicalBoard}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.unmerged).toEqual([]);
    expect(JSON.stringify(deleted.body)).not.toContain(duplicate);
    expect(await state(duplicate)).toMatchObject({
      canonicalPostId: null,
      events: ["post.merged"],
      activity: ["post.merged_away", "post.unmerged"],
    });
  });
});
