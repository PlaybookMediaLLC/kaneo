import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId, PrincipalId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { companies } from "../../database/quills/schema/companies";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
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
  linkedProject,
  removeMembers,
  restrictedMember,
  testCustomer,
} from "./taxonomy-harness.fixture";
import { postIn } from "./seeds.fixture";

// Demand, scores and board voting settings (RFC 0003, features 7, 8 and 9) under a real database.

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
type Importance = "nice" | "important" | "critical";

/** A company of A with this monthly revenue. */
const company = (mrrCents: number) =>
  contractEnv().scoped(contractEnv().a, async (db) => {
    const [row] = await db
      .insert(companies)
      .values({ name: contractEnv().id("company"), mrrCents })
      .returning({ id: companies.id });
    return row!.id;
  });

/** A customer of A, optionally at a company. */
const person = (companyId?: string) =>
  contractEnv().scoped(contractEnv().a, async (db) => {
    const [row] = await db
      .insert(principal)
      .values({
        type: "user",
        role: "user",
        createdAt: new Date(),
        companyId: companyId as never,
      })
      .returning({ id: principal.id });
    return row!.id;
  });

const vote = (postId: PostId, voter: PrincipalId, importance?: Importance) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db.insert(postVotes).values({ postId, principalId: voter, importance }),
  );

/** A post on `boardId` in A, by the owner. */
const postOn = (boardId: string, values: Partial<typeof posts.$inferInsert>) =>
  contractEnv().scoped(contractEnv().a, async (db, actor) => {
    const [row] = await db
      .insert(posts)
      .values({
        title: "Ranked",
        content: "Ranked",
        boardId: boardId as never,
        principalId: actor.principalId,
        ...values,
      })
      .returning({ id: posts.id });
    return row!.id;
  });

const owner = () => contractEnv().owner;

describe.skipIf(!url)("Feedback demand, scores and voting settings", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    await stopContract();
  }, 120000);

  it("counts demand only from boards the caller can see, and each company once", async () => {
    const env = contractEnv();
    const open = await postIn(env, env.a);
    const hidden = await postIn(env, env.a);
    await linkedProject(env, hidden.boardId);
    await env.scoped(env.a, (db) =>
      db
        .update(posts)
        .set({ canonicalPostId: open.postId, mergedAt: new Date() })
        .where(eq(posts.id, hidden.postId)),
    );
    const small = await company(1000);
    const large = await company(5000);
    const first = await person(small);
    const second = await person(small);
    const third = await person(large);
    await vote(open.postId, first, "critical");
    await vote(open.postId, second, "nice");
    // Merged in from the private board: only teammates of its project count it.
    await vote(hidden.postId, third, "important");
    await vote(open.postId, await testCustomer(env));
    const [segment] = await env.scoped(env.a, (db) =>
      db
        .insert(segments)
        .values({ name: env.id("segment"), slug: env.id("segment") })
        .returning({ id: segments.id }),
    );
    await env.scoped(env.a, (db) =>
      db.insert(userSegments).values([
        { principalId: first, segmentId: segment!.id },
        { principalId: third, segmentId: segment!.id },
      ]),
    );

    const all = await call(
      app,
      env,
      owner(),
      "GET",
      `/posts/${open.postId}/demand`,
    );
    expect(all.status).toBe(200);
    expect(all.body).toEqual({
      postId: open.postId,
      voters: 3,
      companies: 2,
      mrrCents: 6000,
      importance: { nice: 1, important: 1, critical: 1 },
      segments: [{ id: segment!.id, name: expect.any(String), voters: 2 }],
    });

    const member = await restrictedMember(env, []);
    const limited = await call(
      app,
      env,
      member,
      "GET",
      `/posts/${open.postId}/demand`,
    );
    expect(limited.status).toBe(200);
    expect(limited.body).toEqual({
      postId: open.postId,
      voters: 2,
      companies: 1,
      mrrCents: 1000,
      importance: { nice: 1, important: 0, critical: 1 },
      segments: [{ id: segment!.id, name: expect.any(String), voters: 1 }],
    });
    // The list summary agrees with the route, for each caller.
    const listed = await call(
      app,
      env,
      member,
      "GET",
      `/posts?boardIds=${open.boardId}`,
    );
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        id: open.postId,
        demand: {
          voters: 2,
          companies: 1,
          mrrCents: 1000,
          importance: { nice: 1, important: 0, critical: 1 },
        },
      }),
    ]);
    expect(
      (await call(app, env, member, "GET", `/posts/${hidden.postId}/demand`))
        .status,
    ).toBe(404);
  });

  it("denies another workspace's post and board", async () => {
    const env = contractEnv();
    const foreign = await postIn(env, env.b);
    for (const path of [
      `/posts/${foreign.postId}/demand`,
      `/boards/${foreign.boardId}/settings`,
    ])
      expect((await call(app, env, owner(), "GET", path)).status).toBe(404);
    expect(
      (
        await call(app, env, owner(), "PUT", `/posts/${foreign.postId}/score`, {
          reach: 1,
          impact: 1,
          confidence: 1,
          effort: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          app,
          env,
          owner(),
          "PATCH",
          `/boards/${foreign.boardId}/settings`,
          { voteDisplay: "hidden" },
        )
      ).status,
    ).toBe(404);
  });

  it("validates RICE inputs and computes the score", async () => {
    const env = contractEnv();
    const { postId } = await postIn(env, env.a);
    const path = `/posts/${postId}/score`;
    const good = { reach: 100, impact: 2, confidence: 80, effort: 4 };
    for (const bad of [
      { ...good, reach: -1 },
      { ...good, reach: 1.5 },
      { ...good, impact: 0.3 },
      { ...good, confidence: 101 },
      { ...good, effort: 0 },
      { ...good, effort: 10001 },
      { reach: 1, impact: 1, confidence: 1 },
    ])
      expect((await call(app, env, owner(), "PUT", path, bad)).status).toBe(
        400,
      );
    const scored = await call(app, env, owner(), "PUT", path, good);
    expect(scored.status).toBe(200);
    expect(scored.body.score).toEqual({ ...good, rice: 40 });
    const cleared = await call(app, env, owner(), "PUT", path, {
      ...good,
      effort: null,
    });
    expect(cleared.body.score).toEqual({ ...good, effort: null, rice: null });
  });

  it("refuses a score and a settings change without the action", async () => {
    const env = contractEnv();
    const { postId, boardId } = await postIn(env, env.a);
    const viewer = await restrictedMember(env, [], "viewer");
    expect(
      (
        await call(app, env, viewer, "PUT", `/posts/${postId}/score`, {
          reach: 1,
          impact: 1,
          confidence: 1,
          effort: 1,
        })
      ).status,
    ).toBe(403);
    // A member updates posts but does not manage settings.
    const member = await restrictedMember(env, [], "member");
    expect(
      (
        await call(app, env, member, "PATCH", `/boards/${boardId}/settings`, {
          voteDisplay: "hidden",
        })
      ).status,
    ).toBe(403);
  });

  it("rolls back a score when the request fails after the write", async () => {
    const env = contractEnv();
    const { postId } = await postIn(env, env.a);
    const declared = [...registry.keys()].find(
      (d) => d.operationId === "setQuillsPostScore",
    )!;
    const failing = contractApp(
      apiRouter<BaseVariables & { workspaceId: string }>().openapi(
        ...buildQuillsRoute({
          ...declared,
          handler: async (input) => {
            await declared.handler(input);
            throw new Error("Injected failure after the score write");
          },
        }),
      ),
    );
    const res = await call(
      failing,
      env,
      owner(),
      "PUT",
      `/posts/${postId}/score`,
      {
        reach: 5,
        impact: 1,
        confidence: 50,
        effort: 1,
      },
    );
    expect(res.status).toBe(500);
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ reach: posts.scoreReach })
        .from(posts)
        .where(eq(posts.id, postId)),
    );
    expect(row!.reach).toBeNull();
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM quills.events WHERE workspace_id=$1 AND type='post.scored' AND entity_id=$2)::int AS events,
              (SELECT count(*) FROM quills.audit_log WHERE workspace_id=$1 AND event_type='post.scored' AND target_id=$2)::int AS audit`,
      [env.a, postId],
    );
    expect(rows[0]).toEqual({ events: 0, audit: 0 });
  });

  it("sorts the teammate list by RICE and by voter revenue across pages", async () => {
    const env = contractEnv();
    const { boardId, postId: first } = await postIn(env, env.a);
    const base = Date.now();
    const at = (n: number) => ({ createdAt: new Date(base - n * 1000) });
    const x = await postOn(boardId, at(1));
    const y = await postOn(boardId, at(2));
    const z = await postOn(boardId, at(3));
    await vote(y, await person(await company(5000)));
    await vote(z, await person(await company(1000)));
    const score = (postId: PostId, body: object) =>
      call(app, env, owner(), "PUT", `/posts/${postId}/score`, body);
    await score(x, { reach: 100, impact: 1, confidence: 100, effort: 1 });
    await score(y, { reach: 10, impact: 3, confidence: 50, effort: 2 });
    await score(z, { reach: 10, impact: null, confidence: 50, effort: 2 });
    const pages = async (sort: string) => {
      const ids: string[] = [];
      let cursor = "";
      do {
        const res = await call(
          app,
          env,
          owner(),
          "GET",
          `/posts?boardIds=${boardId}&sort=${sort}&limit=1${cursor && `&cursor=${cursor}`}`,
        );
        expect(res.status).toBe(200);
        ids.push(...res.body.items.map((item: { id: string }) => item.id));
        cursor = res.body.nextCursor ?? "";
      } while (cursor);
      return ids;
    };
    // The board's own post is the newest and has no score and no revenue.
    expect(await pages("rice")).toEqual([x, y, first, z]);
    expect(await pages("mrr")).toEqual([y, z, first, x]);
  });

  it("sums the revenue at risk once per company, on open posts only", async () => {
    const env = contractEnv();
    const before = (
      await call(app, env, owner(), "GET", "/feedback/revenue-at-risk")
    ).body;
    const risky = await company(700);
    const open = await postIn(env, env.a);
    const other = await postIn(env, env.a);
    const [done] = await env.scoped(env.a, (db) =>
      db
        .insert(postStatuses)
        .values({
          name: env.id("done"),
          slug: env.id("done"),
          category: "complete",
        })
        .returning({ id: postStatuses.id }),
    );
    const shipped = await postIn(env, env.a, { statusId: done!.id });
    await vote(open.postId, await person(risky), "critical");
    await vote(other.postId, await person(risky), "critical");
    await vote(shipped.postId, await person(await company(9000)), "critical");
    await vote(open.postId, await person(await company(300)), "important");
    const after = (
      await call(app, env, owner(), "GET", "/feedback/revenue-at-risk")
    ).body;
    expect(after).toEqual({
      companies: before.companies + 1,
      mrrCents: before.mrrCents + 700,
    });
  });

  it("changes only the voting keys of a board's settings", async () => {
    const env = contractEnv();
    const { boardId } = await postIn(env, env.a);
    await env.scoped(env.a, (db) =>
      db
        .update(boards)
        .set({ settings: { roadmapStatusIds: [] } })
        .where(eq(boards.id, boardId)),
    );
    const path = `/boards/${boardId}/settings`;
    expect((await call(app, env, owner(), "GET", path)).body).toEqual({
      boardId,
      voteDisplay: "count",
      defaultSort: null,
      taskSync: { statusOnTaskDone: null },
    });
    for (const bad of [{}, { voteDisplay: "none" }, { defaultSort: "oldest" }])
      expect((await call(app, env, owner(), "PATCH", path, bad)).status).toBe(
        400,
      );
    const changed = await call(app, env, owner(), "PATCH", path, {
      voteDisplay: "hidden",
      defaultSort: "random",
    });
    expect(changed.body).toEqual({
      boardId,
      voteDisplay: "hidden",
      defaultSort: "random",
      taskSync: { statusOnTaskDone: null },
    });
    expect(
      (await call(app, env, owner(), "PATCH", path, { defaultSort: null }))
        .body,
    ).toEqual({
      boardId,
      voteDisplay: "hidden",
      defaultSort: null,
      taskSync: { statusOnTaskDone: null },
    });
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ settings: boards.settings })
        .from(boards)
        .where(eq(boards.id, boardId)),
    );
    expect(row!.settings).toEqual({
      roadmapStatusIds: [],
      voteDisplay: "hidden",
      defaultSort: null,
    });
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM quills.events WHERE workspace_id=$1 AND type='board.settings_updated' AND entity_id=$2",
      [env.a, boardId],
    );
    expect(rows[0].n).toBe(2);
  });
});
