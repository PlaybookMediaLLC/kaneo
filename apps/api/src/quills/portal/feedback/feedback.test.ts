import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { settings } from "../../../database/quills/schema/auth";
import { postComments, posts } from "../../../database/quills/schema/posts";
import * as kaneo from "../../../database/schema";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
  type ContractInput,
  type Fixture,
} from "../../framework/contract";
import type { AnyQuillsRoute } from "../../framework/define-route";
import { registry } from "../../framework/registry";
import * as portalFixtures from "../index.fixture";
import { enableWidget } from "../../widget/seed.fixture";
import { scene, world } from "./seed.fixture";

// Feature checks for customer feedback that the per-route contract cannot express: the opt-in
// portal, ownership between customers, idempotent creates, moderation and anonymous writes.

let pool: Pool;
vi.mock("../../../database/index", () => ({
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
vi.mock("../../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

async function call(
  method: string,
  path: string,
  options: ContractInput & { user?: string; workspace?: string } = {},
) {
  let target = path;
  for (const [key, value] of Object.entries(options.params ?? {}))
    target = target.replace(`{${key}}`, encodeURIComponent(value));
  const query = new URLSearchParams(options.query).toString();
  const res = await app.request(
    `/quills-public/${options.workspace ?? contractEnv().a}${target}${query ? `?${query}` : ""}`,
    {
      method,
      headers: {
        ...(options.user && { "x-test-user": options.user }),
        ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
        ...(options.body !== undefined && {
          "content-type": "application/json",
        }),
        // A fresh client per request keeps these checks under the rate limits.
        "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Changes one key of workspace A's portal settings and keeps the others. */
async function portal(change: Record<string, unknown>) {
  await contractEnv().scoped(contractEnv().a, async (db) => {
    const [row] = await db
      .select({ text: settings.portalConfig })
      .from(settings);
    await db.update(settings).set({
      portalConfig: JSON.stringify({
        ...JSON.parse(row?.text || "{}"),
        ...change,
      }),
    });
  });
}

/** Every row of workspace A except rate-limit counters, as one hash. */
async function fingerprint() {
  const tables: string[] = (
    await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_attribute t ON t.attrelid=c.oid AND t.attname='workspace_id' AND NOT t.attisdropped
       WHERE n.nspname='quills' AND c.relkind IN ('r','p') AND NOT c.relispartition AND c.relname <> 'rate_bucket'`,
    )
  ).rows.map((row) => row.relname);
  const sql = `SELECT ${tables
    .map(
      (table) =>
        `(SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM quills."${table}" x WHERE x.workspace_id=$1)`,
    )
    .join(" || ")} AS h`;
  return (await pool.query(sql, [contractEnv().a])).rows[0].h as string;
}

describe.skipIf(!url)("Quills customer feedback", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("answers 404 and leaks nothing on every portal and public route while the portal is off", async () => {
    const env = contractEnv();
    const fixtures = portalFixtures as Record<string, Fixture>;
    // Widget routes follow the widget's own flag (paths under /widget).
    const routes = [...registry.keys()].filter(
      (d: AnyQuillsRoute) =>
        d.audience &&
        d.audience !== "teammate" &&
        d.audience !== "widget" &&
        !d.path.startsWith("/widget/"),
    );
    expect(routes.length).toBeGreaterThan(25);
    for (const d of routes) {
      const f = fixtures[d.operationId];
      expect(f, d.operationId).toBeDefined();
      const ids = await f!.seed(env, env.owner);
      await portal({ enabled: false });
      const before = await fingerprint();
      const res = await call(d.method.toUpperCase(), d.path, {
        ...f!.valid(ids),
        user: d.audience === "portal" ? env.customerA : undefined,
      });
      expect([d.operationId, res.status]).toEqual([d.operationId, 404]);
      const text = JSON.stringify(res.body);
      for (const value of [
        ...(f!.hidden?.(ids) ?? []),
        ...(f!.own?.(ids) ?? []),
      ])
        expect(text).not.toContain(value);
      expect([d.operationId, await fingerprint()]).toEqual([
        d.operationId,
        before,
      ]);
    }
  }, 300000);

  it("lets a teammate turn the portal on and off", async () => {
    const env = contractEnv();
    const settingsCall = async (enabled: boolean) => {
      const res = await app.request(`/quills/${env.a}/settings/portal`, {
        method: "PUT",
        headers: {
          "x-test-user": env.owner,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled }),
      });
      return { status: res.status, body: await res.json() };
    };
    expect((await settingsCall(false)).body.enabled).toBe(false);
    expect((await call("GET", "/portal/config")).status).toBe(404);
    expect((await settingsCall(true)).body.enabled).toBe(true);
    expect((await call("GET", "/portal/config")).status).toBe(200);
    // A workspace that never stored the flag (every existing install) is off.
    await portal({ enabled: undefined });
    expect((await call("GET", "/portal/config")).status).toBe(404);
    expect((await call("GET", "/portal/boards")).status).toBe(404);
    await portal({ enabled: true });
  });

  it("closes a private portal to callers it does not admit, in every audience", async () => {
    const env = contractEnv();
    const s = await scene(env, "widget");
    const hidden = s.a.postTitle;
    await portal({ access: { visibility: "private" } });
    try {
      // Customer B has no grant: 403 on every portal read, nothing in the public feeds.
      for (const path of [
        "/portal/boards",
        "/portal/posts",
        "/portal/changelog",
      ])
        expect([
          path,
          (await call("GET", path, { user: env.customerB })).status,
        ]).toEqual([path, 403]);
      const feed = await call("GET", "/changelog/feed");
      const sitemap = await call("GET", "/sitemap");
      expect(feed.body.items).toEqual([]);
      expect(sitemap.body).toEqual({ boards: [], posts: [], changelog: [] });
      // An anonymous widget session is anyone: 403. A visitor the host app identified reads.
      const anonymous = await call("POST", "/widget/anonymous-session");
      const asAnonymous = await call("GET", "/widget/posts", {
        bearer: anonymous.body.sessionToken,
      });
      expect(asAnonymous.status).toBe(403);
      expect(JSON.stringify(asAnonymous.body)).not.toContain(hidden);
      const identified = await call("GET", "/widget/posts", {
        bearer: s.token,
        query: { limit: "50" },
      });
      expect(identified.status).toBe(200);
    } finally {
      await portal({ access: { visibility: "public" } });
    }
  });

  it("mints no anonymous widget session while the widget is off", async () => {
    const env = contractEnv();
    await enableWidget(env, env.a);
    await env.scoped(env.a, (db) =>
      db
        .update(settings)
        .set({ widgetConfig: JSON.stringify({ enabled: false }) }),
    );
    const before = await fingerprint();
    expect((await call("POST", "/widget/anonymous-session")).status).toBe(404);
    expect(await fingerprint()).toBe(before);
  });

  it("applies the author rules: engagement, held edits, team replies and tombstones", async () => {
    const env = contractEnv();
    const s = await scene(env, "portal");
    const a = { user: env.customerA };
    // The author's own vote does not block an edit.
    const created = await call("POST", "/portal/posts", {
      ...a,
      body: { boardId: s.a.boardId, title: "Mine", content: "First" },
    });
    const params = { postId: created.body.id };
    const edit = (content: string) =>
      call("PUT", "/portal/posts/{postId}", {
        ...a,
        params,
        body: { title: "Mine", content },
      });
    expect((await edit("Second")).status).toBe(200);
    // A link added by an edit goes back to review when links are held.
    await portal({ moderationDefault: { holdLinks: true } });
    expect((await edit("See https://spam.example")).body.pending).toBe(true);
    expect(
      (
        await call("GET", "/portal/posts/{postId}", {
          params,
          user: env.customerB,
        })
      ).status,
    ).toBe(404);
    await portal({ moderationDefault: { holdLinks: false } });
    // A vote from someone else blocks edit and delete.
    await edit("Back to plain text");
    await env.scoped(env.a, (db) =>
      db
        .update(posts)
        .set({ moderationState: "published" })
        .where(eq(posts.id, params.postId)),
    );
    expect(
      (
        await call("PUT", "/portal/posts/{postId}/vote", {
          params,
          user: env.customerB,
          body: { voted: true },
        })
      ).status,
    ).toBe(200);
    expect((await edit("Rewritten")).status).toBe(403);
    expect(
      (await call("DELETE", "/portal/posts/{postId}", { ...a, params })).status,
    ).toBe(403);
    // A private teammate note under the author's comment neither blocks nor shows; a public
    // teammate reply blocks.
    const own = s.a.ownComment!;
    const reply = (isPrivate: boolean) =>
      env.scoped(env.a, (db, actor) =>
        db.insert(postComments).values({
          postId: s.a.postId,
          parentId: own,
          principalId: actor.principalId,
          content: "Team",
          isTeamMember: true,
          isPrivate,
        }),
      );
    const editComment = () =>
      call("PUT", "/portal/comments/{commentId}", {
        ...a,
        params: { commentId: own },
        body: { content: "Edited" },
      });
    await reply(true);
    expect((await editComment()).status).toBe(200);
    await reply(false);
    expect((await editComment()).status).toBe(403);
    // A deleted comment keeps its place without its text.
    const mine = await call("POST", "/portal/posts/{postId}/comments", {
      ...a,
      params: { postId: s.a.postId },
      body: { content: "Soon gone" },
    });
    expect(
      (
        await call("DELETE", "/portal/comments/{commentId}", {
          ...a,
          params: { commentId: mine.body.id },
        })
      ).status,
    ).toBe(200);
    const thread = await call("GET", "/portal/posts/{postId}/comments", {
      params: { postId: s.a.postId },
      user: env.customerB,
    });
    const tombstone = thread.body.items.find(
      (c: { id: string }) => c.id === mine.body.id,
    );
    expect(tombstone).toMatchObject({
      deleted: true,
      content: "",
      author: { name: null },
    });
    expect(JSON.stringify(thread.body)).not.toContain("Soon gone");
  });

  it("refuses replies nested deeper than ten levels", async () => {
    const env = contractEnv();
    const s = await scene(env, "portal");
    let parentId: string = s.a.commentId;
    const reply = () =>
      call("POST", "/portal/posts/{postId}/comments", {
        user: env.customerA,
        params: { postId: s.a.postId },
        body: { content: "Deeper", parentId },
      });
    // The seeded comment is level 1; nine replies reach level 10.
    for (let level = 2; level <= 10; level++) {
      const res = await reply();
      expect([level, res.status]).toEqual([level, 200]);
      parentId = res.body.id;
    }
    expect((await reply()).status).toBe(409);
  });

  it("keeps one customer's posts and comments away from another", async () => {
    const env = contractEnv();
    const s = await scene(env, "portal");
    const b = { user: env.customerB };
    const post = { params: { postId: s.a.ownPost! } };
    const comment = { params: { commentId: s.a.ownComment! } };
    expect(
      (
        await call("PUT", "/portal/posts/{postId}", {
          ...post,
          ...b,
          body: { title: "x", content: "y" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("DELETE", "/portal/posts/{postId}", { ...post, ...b }))
        .status,
    ).toBe(403);
    expect(
      (
        await call("PUT", "/portal/comments/{commentId}", {
          ...comment,
          ...b,
          body: { content: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("DELETE", "/portal/comments/{commentId}", {
          ...comment,
          ...b,
        })
      ).status,
    ).toBe(403);
    // Customer B of workspace B names A's post on B's portal: it does not exist there.
    await env.portalCustomer(env.b, env.customerB);
    expect(
      (
        await call("DELETE", "/portal/posts/{postId}", {
          ...post,
          ...b,
          workspace: env.b,
        })
      ).status,
    ).toBe(404);
    // The author still can.
    expect(
      (
        await call("DELETE", "/portal/posts/{postId}", {
          ...post,
          user: env.customerA,
        })
      ).status,
    ).toBe(200);
    // Customer B never sees customer A's held post.
    const listed = await call("GET", "/portal/posts", {
      ...b,
      query: { limit: "50" },
    });
    expect(JSON.stringify(listed.body)).not.toContain(s.a.own[0]);
  });

  it("replays a create with the same idempotency key and rejects another payload", async () => {
    const env = contractEnv();
    const s = await scene(env, "portal");
    const body = {
      boardId: s.a.boardId,
      title: "Once",
      content: "Only once",
      idempotencyKey: s.a.key,
    };
    const events = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quills.events WHERE workspace_id=$1 AND type='post.created'",
          [env.a],
        )
      ).rows[0].n as number;
    const before = await events();
    const first = await call("POST", "/portal/posts", {
      user: env.customerA,
      body,
    });
    const again = await call("POST", "/portal/posts", {
      user: env.customerA,
      body,
    });
    expect(first.body.replayed).toBe(false);
    expect(again.body).toMatchObject({ id: first.body.id, replayed: true });
    expect(await events()).toBe(before + 1);
    const changed = await call("POST", "/portal/posts", {
      user: env.customerA,
      body: { ...body, content: "Something else" },
    });
    expect(changed.status).toBe(409);
    // A receipt belongs to its caller: customer B with the same key creates its own post.
    const other = await call("POST", "/portal/posts", {
      user: env.customerB,
      body,
    });
    expect(other.body.replayed).toBe(false);
    expect(other.body.id).not.toBe(first.body.id);
  });

  it("holds new posts and comments for review and shows them only to their author", async () => {
    const env = contractEnv();
    const s = await scene(env, "portal");
    await portal({ moderationDefault: { requireApproval: "all" } });
    const created = await call("POST", "/portal/posts", {
      user: env.customerA,
      body: { boardId: s.a.boardId, title: "Held idea", content: "Wait" },
    });
    expect(created.body.pending).toBe(true);
    const params = { postId: created.body.id };
    expect(
      (
        await call("GET", "/portal/posts/{postId}", {
          params,
          user: env.customerA,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("GET", "/portal/posts/{postId}", {
          params,
          user: env.customerB,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("GET", "/portal/posts/{postId}", { params })).status,
    ).toBe(404);
    const target = { params: { postId: s.a.postId } };
    const count = async () =>
      (await call("GET", "/portal/posts/{postId}", target)).body
        .commentCount as number;
    const comments = await count();
    const reply = await call("POST", "/portal/posts/{postId}/comments", {
      ...target,
      user: env.customerA,
      body: { content: "Held reply" },
    });
    expect(reply.body.pending).toBe(true);
    expect(await count()).toBe(comments);
    const seen = await call("GET", "/portal/posts/{postId}/comments", {
      ...target,
      user: env.customerB,
    });
    expect(JSON.stringify(seen.body)).not.toContain("Held reply");
    await portal({ moderationDefault: { requireApproval: "none" } });
  });

  it("sets votes as desired state and counts each person once", async () => {
    const env = contractEnv();
    const s = await scene(env, "portal");
    const vote = (voted: boolean) =>
      call("PUT", "/portal/posts/{postId}/vote", {
        params: { postId: s.a.postId },
        user: env.customerA,
        body: { voted },
      });
    const start = (
      await call("GET", "/portal/posts/{postId}", {
        params: { postId: s.a.postId },
      })
    ).body.voteCount as number;
    expect((await vote(true)).body).toMatchObject({
      voted: true,
      changed: true,
      voteCount: start + 1,
    });
    expect((await vote(true)).body).toMatchObject({
      changed: false,
      voteCount: start + 1,
    });
    expect((await vote(false)).body).toMatchObject({
      voted: false,
      changed: true,
      voteCount: start,
    });
    expect((await vote(false)).body).toMatchObject({
      changed: false,
      voteCount: start,
    });
  });

  it("lets an anonymous widget visitor write only while anonymous interaction is on", async () => {
    const env = contractEnv();
    await enableWidget(env, env.a);
    const a = await world(env, env.a);
    const session = await call("POST", "/widget/anonymous-session");
    expect(session.status).toBe(200);
    const vote = () =>
      call("PUT", "/widget/posts/{postId}/vote", {
        params: { postId: a.postId },
        bearer: session.body.sessionToken,
        body: { voted: true },
      });
    await portal({ features: { allowAnonymous: false } });
    expect((await vote()).status).toBe(403);
    const boards = await call("GET", "/widget/boards", {
      bearer: session.body.sessionToken,
    });
    expect(boards.body.items[0]).toMatchObject({
      canVote: false,
      canSubmit: false,
    });
    await portal({ features: { allowAnonymous: true } });
    expect((await vote()).body).toMatchObject({ voted: true, changed: true });
    // Without a session, widget reads ask for one.
    expect((await call("GET", "/widget/posts")).status).toBe(401);
  });
});
