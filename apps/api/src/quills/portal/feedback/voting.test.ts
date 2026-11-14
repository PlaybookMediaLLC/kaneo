import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { toUuid, type BoardId, type PostId } from "@kaneo/ids";
import { settings } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { posts, postVotes } from "../../../database/quills/schema/posts";
import * as kaneo from "../../../database/schema";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import { enableWidget } from "../../widget/seed.fixture";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";

// Vote importance and the voting-bias board settings (RFC 0003, features 3 and 9) on the
// customer routes, under a real database.

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

async function request(
  method: string,
  path: string,
  options: {
    user?: string;
    bearer?: string;
    body?: unknown;
    teammate?: boolean;
  } = {},
) {
  const env = contractEnv();
  const res = await app.request(
    options.teammate
      ? `/quills/${env.a}${path}`
      : `/quills-public/${env.a}${path}`,
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
  return { status: res.status, body: (await res.json()) as any };
}

/** A public board in A with `n` posts titled `label`, newest first. */
async function board(n: number, label = "Idea") {
  const env = contractEnv();
  return env.scoped(env.a, async (db, actor) => {
    const [row] = await db
      .insert(boards)
      .values({ name: "Voting", slug: env.id("voting") })
      .returning({ id: boards.id });
    const ids: PostId[] = [];
    for (let i = 0; i < n; i++) {
      const [post] = await db
        .insert(posts)
        .values({
          boardId: row!.id,
          title: `${label} ${i}`,
          content: "Body",
          principalId: actor.principalId,
          voteCount: i,
          createdAt: new Date(Date.now() - i * 1000),
        })
        .returning({ id: posts.id });
      ids.push(post!.id);
    }
    return { boardId: row!.id, postIds: ids };
  });
}

const setBoard = (boardId: BoardId, body: object) =>
  request("PATCH", `/boards/${boardId}/settings`, {
    user: contractEnv().owner,
    body,
    teammate: true,
  });

const eventTypes = async (postId: string, since: string) =>
  (
    await pool.query(
      "SELECT type, payload FROM quills.events WHERE workspace_id=$1 AND entity_id=$2 AND occurred_at >= $3::timestamptz ORDER BY id",
      [contractEnv().a, postId, since],
    )
  ).rows as { type: string; payload: Record<string, string> }[];

const now = async () =>
  (await pool.query("SELECT clock_timestamp()::text AS t")).rows[0].t as string;

/** The order that the random sort gives `seed`, computed here from its definition. */
const shuffled = (seed: string, ids: PostId[]) =>
  [...ids].sort((a, b) => {
    const rank = (id: PostId) =>
      createHash("md5")
        .update(`${seed}${toUuid(id)}`)
        .digest("hex");
    return rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : a < b ? -1 : 1;
  });

describe.skipIf(!url)("Quills customer voting", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    const env = contractEnv();
    await env.scoped(env.a, (db) =>
      db.update(settings).set({
        portalConfig: JSON.stringify({
          enabled: true,
          features: { allowAnonymous: true },
        }),
      }),
    );
  }, 120000);
  afterAll(() => stopContract(), 120000);

  it("sets, keeps and clears the importance of the caller's vote", async () => {
    const env = contractEnv();
    const {
      postIds: [postId],
    } = await board(1);
    const path = `/portal/posts/${postId}/vote`;
    const as = { user: env.customerA };
    const since = await now();
    const first = await request("PUT", path, {
      ...as,
      body: { voted: true, importance: "critical" },
    });
    expect(first.body).toMatchObject({
      voted: true,
      changed: true,
      importance: "critical",
    });
    const repeat = await request("PUT", path, {
      ...as,
      body: { voted: true, importance: "critical" },
    });
    expect(repeat.body).toMatchObject({
      changed: false,
      importance: "critical",
    });
    const lower = await request("PUT", path, {
      ...as,
      body: { voted: true, importance: "nice" },
    });
    expect(lower.body).toMatchObject({ changed: false, importance: "nice" });
    // A vote without importance keeps the stored one.
    const plain = await request("PUT", path, { ...as, body: { voted: true } });
    expect(plain.body).toMatchObject({ changed: false, importance: "nice" });
    expect(
      (await request("GET", `/portal/posts/${postId}`, as)).body.importance,
    ).toBe("nice");
    for (const bad of [
      { voted: false, importance: "nice" },
      { voted: true, importance: "urgent" },
    ])
      expect((await request("PUT", path, { ...as, body: bad })).status).toBe(
        400,
      );
    const removed = await request("PUT", path, {
      ...as,
      body: { voted: false },
    });
    expect(removed.body).toMatchObject({
      voted: false,
      changed: true,
      importance: null,
    });
    const events = await eventTypes(postId!, since);
    expect(events.map((e) => e.type)).toEqual([
      "post.voted",
      "post.vote_importance_set",
      "post.vote_importance_set",
      "post.unvoted",
    ]);
    expect(events[1]!.payload).toMatchObject({ importance: "critical" });
    expect(events[2]!.payload).toMatchObject({ importance: "nice" });
    // A new vote starts without importance.
    await request("PUT", path, { ...as, body: { voted: true } });
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ importance: postVotes.importance })
        .from(postVotes)
        .where(and(eq(postVotes.postId, postId!))),
    );
    expect(row!.importance).toBeNull();
  });

  it("leaves vote counts out of every customer response when the board hides them", async () => {
    const env = contractEnv();
    const { boardId, postIds } = await board(2, "Zanzibar");
    await setBoard(boardId, { voteDisplay: "hidden" });
    const as = { user: env.customerA };
    const list = await request(
      "GET",
      `/portal/posts?boardId=${boardId}&sort=votes`,
      as,
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    for (const item of list.body.items)
      expect(item).not.toHaveProperty("voteCount");
    const post = await request("GET", `/portal/posts/${postIds[0]}`, as);
    expect(post.body).not.toHaveProperty("voteCount");
    expect(post.body.canVote).toBe(true);
    const voted = await request("PUT", `/portal/posts/${postIds[0]}/vote`, {
      ...as,
      body: { voted: true },
    });
    expect(voted.body).toMatchObject({ voted: true, changed: true });
    expect(voted.body).not.toHaveProperty("voteCount");
    const similar = await request(
      "GET",
      "/portal/posts/similar?title=Zanzibar",
      as,
    );
    expect(similar.body.items).toHaveLength(2);
    for (const item of similar.body.items)
      expect(item).not.toHaveProperty("voteCount");
    // The widget hides them too.
    await enableWidget(env, env.a);
    const visitor = await env.widgetVisitor(env.a);
    const widget = await request("GET", `/widget/posts?boardId=${boardId}`, {
      bearer: visitor.token,
    });
    expect(widget.status).toBe(200);
    expect(widget.body.items).toHaveLength(2);
    for (const item of widget.body.items)
      expect(item).not.toHaveProperty("voteCount");
    const widgetVote = await request(
      "PUT",
      `/widget/posts/${postIds[1]}/vote`,
      {
        bearer: visitor.token,
        body: { voted: true },
      },
    );
    expect(widgetVote.body).toMatchObject({ voted: true });
    expect(widgetVote.body).not.toHaveProperty("voteCount");
    const boardsList = await request("GET", "/portal/boards", as);
    expect(
      boardsList.body.items.find((b: { id: string }) => b.id === boardId),
    ).toMatchObject({ voteDisplay: "hidden", defaultSort: null });
    // Teammates keep the count.
    const teammate = await request("GET", `/posts/${postIds[0]}`, {
      user: env.owner,
      teammate: true,
    });
    expect(teammate.body.voteCount).toBe(1);
    // Showing counts again brings them back.
    await setBoard(boardId, { voteDisplay: "count" });
    const shown = await request("GET", `/portal/posts/${postIds[0]}`, as);
    expect(shown.body.voteCount).toBe(1);
  });

  it("orders a board by its default sort, and random stays stable for a viewer for a day", async () => {
    const env = contractEnv();
    const { boardId, postIds } = await board(6);
    const list = async (user?: string, cursor?: string) =>
      request(
        "GET",
        `/portal/posts?boardId=${boardId}&limit=4${cursor ? `&cursor=${cursor}` : ""}`,
        { user },
      );
    // No board default: newest.
    expect(
      (await list(env.customerA)).body.items.map((i: { id: string }) => i.id),
    ).toEqual(postIds.slice(0, 4));
    await setBoard(boardId, { defaultSort: "votes" });
    expect(
      (await list(env.customerA)).body.items.map((i: { id: string }) => i.id),
    ).toEqual([...postIds].reverse().slice(0, 4));

    await setBoard(boardId, { defaultSort: "random" });
    const { principalId } = await env.portalCustomer(env.a, env.customerA);
    const day = new Date().toISOString().slice(0, 10);
    const pages = async (user?: string) => {
      const first = await list(user);
      const second = await list(user, first.body.nextCursor);
      return [...first.body.items, ...second.body.items].map(
        (i: { id: string }) => i.id,
      );
    };
    const mine = await pages(env.customerA);
    expect(mine).toEqual(shuffled(`${principalId}:${day}`, postIds));
    expect(await pages(env.customerA)).toEqual(mine);
    expect(await pages()).toEqual(shuffled(`anonymous:${day}`, postIds));
    // An explicit sort wins over the board default.
    const newest = await request(
      "GET",
      `/portal/posts?boardId=${boardId}&sort=newest&limit=6`,
      { user: env.customerA },
    );
    expect(newest.body.items.map((i: { id: string }) => i.id)).toEqual(postIds);
  });
});
