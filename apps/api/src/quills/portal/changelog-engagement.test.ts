import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { changelogReactions } from "../../database/quills/schema/changelog-engagement";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { posts, postVotes } from "../../database/quills/schema/posts";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { customerPost, enablePortal } from "./customer-seed.fixture";

// Changelog engagement (RFC 0003, feature 15) and "my feedback" (feature 16) under a real
// database: workspaces A and B, portal customers A and B, and a widget visitor.

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
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
vi.mock("../../ws", () => ({ broadcastToUserAndWait: vi.fn(async () => {}) }));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

async function call(
  method: string,
  path: string,
  options: {
    user?: string;
    bearer?: string;
    body?: unknown;
    teammate?: boolean;
    workspace?: string;
  } = {},
) {
  const env = contractEnv();
  const base = options.teammate ? "/quills" : "/quills-public";
  const res = await app.request(
    `${base}/${options.workspace ?? env.a}${path}`,
    {
      method,
      headers: {
        "x-test-user": options.user ?? "",
        "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
        ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
        ...(options.body !== undefined && {
          "content-type": "application/json",
        }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A published entry in a workspace, published `ago` milliseconds back or at the database's now. */
const entryIn = (workspaceId: string, ago: number | "now", values = {}) =>
  contractEnv().scoped(workspaceId, async (db) => {
    const [row] = await db
      .insert(changelogEntries)
      .values({
        title: contractEnv().id("entry"),
        content: "Shipped",
        publishedAt: ago === "now" ? sql`now()` : new Date(Date.now() - ago),
        ...values,
      })
      .returning({ id: changelogEntries.id });
    return row!.id;
  });

describe.skipIf(!url)("Quills changelog engagement and my feedback", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await startContract(pool, url!);
    const env = contractEnv();
    await enablePortal(env, env.a);
    await enablePortal(env, env.b);
  }, 120000);
  afterAll(async () => {
    await stopContract();
  });

  it("keeps one reaction per caller, entry and emoji, from the bounded set", async () => {
    const env = contractEnv();
    const entry = await entryIn(env.a, 60_000);
    const foreign = await entryIn(env.b, 60_000);
    const draft = await env.scoped(env.a, async (db) => {
      const [row] = await db
        .insert(changelogEntries)
        .values({ title: env.id("draft"), content: "Draft" })
        .returning({ id: changelogEntries.id });
      return row!.id;
    });
    const react = (
      id: string,
      emoji: string,
      reacted = true,
      user = env.customerA,
    ) =>
      call("PUT", `/portal/changelog/${id}/reactions`, {
        user,
        body: { emoji, reacted },
      });

    const first = await react(entry, "🎉");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      changed: true,
      reactions: [{ emoji: "🎉", count: 1, reacted: true }],
    });
    // The same reaction again changes nothing and keeps one row.
    expect((await react(entry, "🎉")).body).toMatchObject({ changed: false });
    const other = await react(entry, "🎉", true, env.customerB);
    expect(other.body.reactions).toEqual([
      { emoji: "🎉", count: 2, reacted: true },
    ]);
    // Concurrent duplicates cannot defeat the primary key.
    await Promise.all([react(entry, "🚀"), react(entry, "🚀")]);
    const rows = await env.scoped(env.a, (db) =>
      db
        .select({ emoji: changelogReactions.emoji })
        .from(changelogReactions)
        .where(eq(changelogReactions.changelogEntryId, entry)),
    );
    expect(rows.map((row) => row.emoji).sort()).toEqual(["🎉", "🎉", "🚀"]);

    // Outside the emoji set, a foreign entry and a draft are refused and change nothing.
    expect((await react(entry, "🦄")).status).toBe(400);
    expect((await react(foreign, "🎉")).status).toBe(404);
    expect((await react(draft, "🎉")).status).toBe(404);
    expect(
      (
        await env.scoped(env.b, (db) => db.select().from(changelogReactions))
      ).filter((row) => row.changelogEntryId === foreign),
    ).toEqual([]);

    // The list shows the counts and the caller's own reactions.
    const listed = await call("GET", "/portal/changelog", {
      user: env.customerB,
    });
    const shown = listed.body.entries.find(
      (item: { id: string }) => item.id === entry,
    );
    expect(shown.reactions).toEqual([
      { emoji: "🎉", count: 2, reacted: true },
      { emoji: "🚀", count: 1, reacted: false },
    ]);

    const removed = await react(entry, "🚀", false);
    expect(removed.body).toMatchObject({ changed: true });
    expect(removed.body.reactions).toEqual([
      { emoji: "🎉", count: 2, reacted: true },
    ]);
  });

  it("counts unread entries per caller and moves only the caller's read mark", async () => {
    const env = contractEnv();
    const visitor = await env.widgetVisitor(env.a);
    // A new widget visitor has nothing unread: older entries predate its profile.
    expect(
      (
        await call("GET", "/widget/changelog/unread", {
          bearer: visitor.token,
        })
      ).body,
    ).toEqual({ count: 0 });
    await call("PUT", "/portal/changelog/read", { user: env.customerA });
    await call("PUT", "/portal/changelog/read", { user: env.customerB });
    const unread = (user: string) =>
      call("GET", "/portal/changelog/unread", { user });
    expect((await unread(env.customerA)).body).toEqual({ count: 0 });

    const fresh = await entryIn(env.a, "now");
    // A segment entry and workspace B's entry are not counted.
    await entryIn(env.a, "now", { segmentIds: [env.id("segment")] });
    await entryIn(env.b, "now");
    expect((await unread(env.customerA)).body).toEqual({ count: 1 });
    expect((await unread(env.customerB)).body).toEqual({ count: 1 });
    expect(
      (
        await call("GET", "/widget/changelog/unread", {
          bearer: visitor.token,
        })
      ).body,
    ).toEqual({ count: 1 });
    const listed = await call("GET", "/portal/changelog", {
      user: env.customerA,
    });
    expect(
      listed.body.entries.find((item: { id: string }) => item.id === fresh),
    ).toMatchObject({ unread: true });

    const marked = await call("PUT", "/portal/changelog/read", {
      user: env.customerA,
    });
    expect(marked.status).toBe(200);
    expect((await unread(env.customerA)).body).toEqual({ count: 0 });
    // Customer B and the widget visitor keep their own marks.
    expect((await unread(env.customerB)).body).toEqual({ count: 1 });
    // A caller without a session has nothing unread.
    expect((await unread("")).body).toEqual({ count: 0 });

    // Teammates see the readers and reactions of each entry; B's rows never count in A.
    await call("PUT", `/portal/changelog/${fresh}/reactions`, {
      user: env.customerB,
      body: { emoji: "👀", reacted: true },
    });
    const stats = await call("GET", "/changelog-engagement", {
      user: env.owner,
      teammate: true,
    });
    expect(stats.status).toBe(200);
    expect(
      stats.body.items.find((item: { id: string }) => item.id === fresh),
    ).toMatchObject({ readCount: 1, reactions: [{ emoji: "👀", count: 1 }] });
    const foreign = await call("GET", "/changelog-engagement", {
      user: env.owner,
      teammate: true,
      workspace: env.b,
    });
    // The owner of A is no member of B: the workspace route does not disclose B.
    expect(foreign.status).toBe(404);
  });

  it("lists the caller's own, voted and followed posts that it may still see", async () => {
    const env = contractEnv();
    const me = (await env.portalCustomer(env.a, env.customerA))
      .principalId as PrincipalId;
    const voted = await customerPost(env, env.a);
    const followed = await customerPost(env, env.a);
    const unrelated = await customerPost(env, env.a);
    const hidden = await customerPost(env, env.a);
    const foreign = await customerPost(env, env.b);
    const other = (await env.portalCustomer(env.a, env.customerB))
      .principalId as PrincipalId;
    await env.scoped(env.a, async (db) => {
      await db.insert(postVotes).values([
        { postId: voted.postId, principalId: me },
        { postId: hidden.postId, principalId: me },
        { postId: unrelated.postId, principalId: other },
      ]);
      await db.insert(postSubscriptions).values({
        postId: followed.postId,
        principalId: me,
        reason: "manual",
      });
      // A post on a team-only board stops showing even though the customer voted for it.
      const [post] = await db
        .select({ boardId: posts.boardId })
        .from(posts)
        .where(eq(posts.id, hidden.postId as PostId));
      await db
        .update(boards)
        .set({
          access: {
            view: "team",
            vote: "team",
            submit: "team",
            comment: "team",
            segments: { view: [], vote: [], submit: [], comment: [] },
            moderation: {
              comments: "inherit",
              anonPosts: "inherit",
              signedPosts: "inherit",
            },
          },
        })
        .where(eq(boards.id, post!.boardId));
    });
    const mine = await call("GET", "/portal/my-feedback?limit=50", {
      user: env.customerA,
    });
    expect(mine.status).toBe(200);
    const ids = mine.body.items.map((item: { id: string }) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([voted.postId, followed.postId]),
    );
    for (const id of [unrelated.postId, hidden.postId, foreign.postId])
      expect(ids).not.toContain(id);
    expect(
      mine.body.items.find((item: { id: string }) => item.id === voted.postId),
    ).toMatchObject({ voted: true, following: false, isAuthor: false });

    const onlyFollowed = await call(
      "GET",
      "/portal/my-feedback?filter=following",
      { user: env.customerA },
    );
    expect(
      onlyFollowed.body.items.map((item: { id: string }) => item.id),
    ).toEqual([followed.postId]);
    const paged = await call("GET", "/portal/my-feedback?limit=1", {
      user: env.customerA,
    });
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.nextOffset).toBe(1);
    expect(
      (
        await call("GET", "/portal/my-feedback?limit=51", {
          user: env.customerA,
        })
      ).status,
    ).toBe(400);
    // Customer B sees only its own vote; a caller without a session is refused.
    const theirs = await call("GET", "/portal/my-feedback", {
      user: env.customerB,
    });
    expect(theirs.body.items.map((item: { id: string }) => item.id)).toEqual([
      unrelated.postId,
    ]);
    expect((await call("GET", "/portal/my-feedback")).status).toBe(401);
  });

  it("turns the weekly digest off and on for the caller only", async () => {
    const env = contractEnv();
    const get = (user: string) => call("GET", "/user/weekly-digest", { user });
    expect((await get(env.customerA)).body).toEqual({ weeklyDigest: true });
    const off = await call("PUT", "/user/weekly-digest", {
      user: env.customerA,
      body: { weeklyDigest: false },
    });
    expect(off.body).toEqual({ weeklyDigest: false });
    expect((await get(env.customerA)).body).toEqual({ weeklyDigest: false });
    expect((await get(env.customerB)).body).toEqual({ weeklyDigest: true });
    expect(
      (
        await call("PUT", "/user/weekly-digest", {
          user: env.customerA,
          body: { weeklyDigest: true },
        })
      ).body,
    ).toEqual({ weeklyDigest: true });
    expect((await get(env.customerA)).body).toEqual({ weeklyDigest: true });
    expect(
      (
        await call("PUT", "/user/weekly-digest", {
          body: { weeklyDigest: false },
        })
      ).status,
    ).toBe(401);
  });
});
