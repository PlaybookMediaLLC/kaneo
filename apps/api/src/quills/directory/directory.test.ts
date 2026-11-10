import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { principal, user } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
import * as kaneo from "../../database/schema";
import { apiRouter, type BaseVariables } from "../../openapi";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import {
  buildQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { registry } from "../framework/registry";
import { MAX_DYNAMIC_MEMBERS } from "./segment-rules";
import { customer, segment } from "./seed.fixture";

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
type App = ReturnType<typeof contractApp>;

async function call(
  method: string,
  path: string,
  body?: unknown,
  on: App = app,
) {
  const env = contractEnv();
  const res = await on.request(`/quills/${env.a}${path}`, {
    method,
    headers: {
      "x-test-user": env.owner,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const inA = <T>(
  work: Parameters<ReturnType<typeof contractEnv>["scoped"]>[1],
) => contractEnv().scoped(contractEnv().a, work) as Promise<T>;
const ownerPrincipal = () =>
  inA<string>(async (_db, actor) => actor.principalId);

/** A post in workspace A by `principalId`. */
const postBy = (principalId: string) =>
  inA<string>(async (db) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Feature", slug: contractEnv().id("board") })
      .returning({ id: boards.id });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .limit(1);
    const [post] = await db
      .insert(posts)
      .values({
        title: "Feature",
        content: "Feature",
        boardId: board!.id,
        principalId: principalId as never,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    return post!.id;
  });

describe.skipIf(!url)("Quills directory", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("lists customers only: no teammate, linked member profile, test customer or workspace B customer", async () => {
    const env = contractEnv();
    const owner = await ownerPrincipal();
    const real = await customer(env, env.a);
    const lead = await customer(env, env.a, { lead: true });
    const foreign = await customer(env, env.b);
    const testCustomer = await customer(env, env.a);
    const linked = await inA<string>(async (db) => {
      await db
        .update(principal)
        .set({ testOwnerPrincipalId: owner as never })
        .where(eq(principal.id, testCustomer as never));
      // A customer profile linked to a Kaneo member is that teammate, not a customer.
      const [identity] = await db
        .insert(user)
        .values({ name: "Teammate profile", kaneoUserId: env.owner })
        .returning({ id: user.id });
      const [row] = await db
        .insert(principal)
        .values({
          userId: identity!.id,
          role: "user",
          type: "user",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      return row!.id;
    });

    const users = await call("GET", "/users?limit=100");
    expect(users.status).toBe(200);
    const listed = users.body.items.map(
      (p: { principalId: string }) => p.principalId,
    );
    expect(listed).toContain(real);
    for (const hidden of [owner, foreign, testCustomer, linked, lead])
      expect(listed).not.toContain(hidden);
    expect(users.body.total).toBe(listed.length);

    const leads = await call("GET", "/users?lifecycle=leads&limit=100");
    expect(
      leads.body.items.map((p: { principalId: string }) => p.principalId),
    ).toEqual([lead]);

    for (const hidden of [owner, foreign, testCustomer, linked])
      expect((await call("GET", `/users/${hidden}`)).status).toBe(404);
    expect((await call("PUT", `/users/${owner}/block`)).status).toBe(404);
  });

  it("adds segment members all or nothing", async () => {
    const env = contractEnv();
    const segmentId = await segment(env, env.a);
    const real = await customer(env, env.a);
    const foreign = await customer(env, env.b);
    const members = () =>
      inA<number>(
        async (db) =>
          (
            await db
              .select({ n: count() })
              .from(userSegments)
              .where(eq(userSegments.segmentId, segmentId as never))
          )[0]!.n,
      );

    for (const bad of [foreign, await ownerPrincipal()]) {
      const res = await call("POST", `/segments/${segmentId}/members`, {
        principalIds: [real, bad],
      });
      expect(res.status).toBe(404);
      expect(await members()).toBe(0);
    }
    const ok = await call("POST", `/segments/${segmentId}/members`, {
      principalIds: [real, real],
    });
    expect(ok).toMatchObject({ status: 200, body: { added: 1 } });
    expect(await members()).toBe(1);
  });

  it("refuses an evaluation that matches more than the bound, and changes nothing", async () => {
    const env = contractEnv();
    const segmentId = await segment(env, env.a, "dynamic");
    await pool.query(
      `INSERT INTO quills.customer_identity (workspace_id, id, name, email)
       SELECT $1, gen_random_uuid(), 'Bulk', 'bulk' || g || '@bulk.test' FROM generate_series(1, $2::int) g`,
      [env.a, MAX_DYNAMIC_MEMBERS + 1],
    );
    await pool.query(
      `INSERT INTO quills.principal (workspace_id, id, user_id, role, type, created_at)
       SELECT workspace_id, gen_random_uuid(), id, 'user', 'user', now() FROM quills.customer_identity
       WHERE workspace_id = $1 AND email LIKE '%@bulk.test'`,
      [env.a],
    );
    // Production tables have planner statistics; a fresh bulk insert has none until autovacuum runs.
    await pool.query("ANALYZE quills.customer_identity, quills.principal");
    const rules = (operator: string, value: string) => ({
      rules: {
        match: "all",
        conditions: [{ attribute: "email", operator, value }],
      },
    });
    expect(
      (
        await call(
          "PUT",
          `/segments/${segmentId}`,
          rules("ends_with", "@bulk.test"),
        )
      ).status,
    ).toBe(200);
    const tooMany = await call("POST", `/segments/${segmentId}/evaluate`);
    expect(tooMany.status).toBe(409);
    const stored = await inA<number>(
      async (db) =>
        (
          await db
            .select({ n: count() })
            .from(userSegments)
            .where(eq(userSegments.segmentId, segmentId as never))
        )[0]!.n,
    );
    expect(stored).toBe(0);

    await call("PUT", `/segments/${segmentId}`, rules("eq", "bulk7@bulk.test"));
    const one = await call("POST", `/segments/${segmentId}/evaluate`);
    expect(one).toMatchObject({
      status: 200,
      body: { added: 1, removed: 0, members: 1 },
    });

    // Evaluate-all skips the oversized segment and keeps its members.
    const big = await segment(env, env.a, "dynamic");
    await call("PUT", `/segments/${big}`, rules("ends_with", "@bulk.test"));
    const all = await call("POST", "/segments/evaluate");
    expect(all.status).toBe(200);
    expect(
      all.body.results.find((r: { segmentId: string }) => r.segmentId === big),
    ).toMatchObject({ skipped: true, members: 0 });
    await inA(async (db) =>
      db
        .update(segments)
        .set({ deletedAt: new Date() })
        .where(eq(segments.id, big as never)),
    );
  }, 60000);

  it("merges a lead's activity into a customer, and rolls back on failure", async () => {
    const env = contractEnv();
    const lead = await customer(env, env.a, { lead: true });
    const target = await customer(env, env.a);
    const leadPost = await postBy(lead);
    const shared = await postBy(target);
    await inA(async (db) =>
      db.insert(postVotes).values([
        { postId: shared as never, principalId: lead as never },
        { postId: shared as never, principalId: target as never },
      ]),
    );

    const merged = await call("POST", `/users/${lead}/merge`, {
      targetPrincipalId: target,
    });
    expect(merged).toMatchObject({
      status: 200,
      body: { principalId: target },
    });
    await inA(async (db) => {
      const [post] = await db
        .select({ principalId: posts.principalId })
        .from(posts)
        .where(eq(posts.id, leadPost as never));
      expect(post!.principalId).toBe(target);
      const votes = await db
        .select({ principalId: postVotes.principalId })
        .from(postVotes)
        .where(eq(postVotes.postId, shared as never));
      expect(votes).toEqual([{ principalId: target }]);
      expect(
        await db
          .select()
          .from(principal)
          .where(eq(principal.id, lead as never)),
      ).toEqual([]);
    });

    // The same merge with a failure after the writes leaves the lead untouched.
    const failingLead = await customer(env, env.a, { lead: true });
    const failingPost = await postBy(failingLead);
    const d = [...registry.keys()].find(
      (r) => r.operationId === "mergeQuillsLeadIntoUser",
    ) as AnyQuillsRoute;
    const failing = contractApp(
      apiRouter<BaseVariables & { workspaceId: string }>().openapi(
        ...buildQuillsRoute({
          ...d,
          handler: async (input) => {
            await d.handler(input);
            throw new Error("Injected failure after the merge");
          },
        }),
      ),
    );
    const res = await call(
      "POST",
      `/users/${failingLead}/merge`,
      { targetPrincipalId: target },
      failing,
    );
    expect(res.status).toBe(500);
    await inA(async (db) => {
      const [post] = await db
        .select({ principalId: posts.principalId })
        .from(posts)
        .where(eq(posts.id, failingPost as never));
      expect(post!.principalId).toBe(failingLead);
      expect(
        await db
          .select({ id: principal.id })
          .from(principal)
          .where(
            and(
              eq(principal.id, failingLead as never),
              eq(principal.type, "anonymous"),
            ),
          ),
      ).toHaveLength(1);
    });
  });

  it("refuses to remove a customer who still authors content", async () => {
    const env = contractEnv();
    const author = await customer(env, env.a);
    await postBy(author);
    const res = await call("DELETE", `/users/${author}`);
    expect(res.status).toBe(409);
    expect((await call("GET", `/users/${author}`)).status).toBe(200);
  });
});
