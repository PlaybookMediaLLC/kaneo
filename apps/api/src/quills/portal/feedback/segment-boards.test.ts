import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostId, PrincipalId, SegmentId } from "@kaneo/ids";
import * as kaneo from "../../../database/schema";
import type { Database } from "../../../database/quills/client";
import { principal } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { changelogEntryPosts } from "../../../database/quills/schema/changelog";
import { events } from "../../../database/quills/schema/events";
import { postVotes } from "../../../database/quills/schema/posts";
import {
  segments,
  userSegments,
} from "../../../database/quills/schema/segments";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import { users } from "../../framework/contract-world";
import { scene, type Scene } from "./seed.fixture";

// RFC 0003 D11: a board with visible segment IDs. Every customer read path hides it from a
// signed-in non-member and from an anonymous caller with a non-disclosing 404, and shows it to
// a member. The teammate board update accepts only live segments of the same workspace.

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

type Options = {
  user?: string;
  bearer?: string;
  body?: unknown;
  scope?: object;
};
async function call(method: string, path: string, options: Options = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(options.user && { "x-test-user": options.user }),
      ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
      ...(options.scope && { "x-test-scope": JSON.stringify(options.scope) }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
      // A fresh client per request keeps these checks under the rate limits.
      "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, text, body: safeJson(text) };
}
const safeJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const env = () => contractEnv();
const pub = (path: string, options: Options = {}) =>
  call(
    options.body === undefined ? "GET" : "PUT",
    `/quills-public/${env().a}${path}`,
    options,
  );
const team = (path: string, body: unknown, options: Options = {}) =>
  call("PATCH", `/quills/${env().a}${path}`, {
    user: env().owner,
    body,
    ...options,
  });
const inA = <T>(work: (db: Database) => Promise<T>) =>
  env().scoped(env().a, work);

/** The hidden text of the segment board, its post and its comment in workspace A. */
const segmentText = (s: Scene) =>
  ["board", "post", "comment"].map((name) =>
    s.a.hidden.find((value) => value.includes(`_segment-${name}_`))!,
  );

async function join(principalId: string, segmentId: string) {
  await inA(async (db) => {
    await db.insert(userSegments).values({
      principalId: principalId as PrincipalId,
      segmentId: segmentId as SegmentId,
    });
  });
}

/** Every customer read of the segment board's content, for one caller. */
async function reads(s: Scene, who: Options, prefix: "portal" | "widget") {
  const post = s.a.segmentPostId;
  const base = `/${prefix}`;
  const list = [
    await pub(`${base}/boards`, who),
    await pub(`${base}/posts?limit=50`, who),
    await pub(`${base}/posts?search=segment&limit=50`, who),
    await pub(
      `${base}/posts/similar?title=${encodeURIComponent(segmentText(s)[1]!)}`,
      who,
    ),
    await pub(`${base}/voted-posts`, who),
    await pub(`${base}/changelog/${s.a.entryId}`, who),
  ];
  if (prefix === "portal")
    list.push(await pub(`/portal/roadmaps/${s.a.roadmapId}/posts`, who));
  const direct = {
    board: await pub(`${base}/posts?boardId=${s.a.segmentBoardId}`, who),
    post: await pub(`${base}/posts/${post}`, who),
    comments: await pub(`${base}/posts/${post}/comments`, who),
    vote: await pub(`${base}/posts/${post}/vote`, {
      ...who,
      body: { voted: true },
    }),
    follow: await pub(`${base}/posts/${post}/follow`, {
      ...who,
      body: { following: true },
    }),
    ...(prefix === "portal" && {
      subscription: await pub(`/posts/${post}/subscription`, who),
    }),
  };
  return { list, direct };
}

describe.skipIf(!url)("Quills segment boards (RFC 0003 D11)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("hides a segment board from portal non-members and anonymous callers, and shows it to members", async () => {
    const s = await scene(env(), "portal");
    const hidden = segmentText(s);
    expect(hidden).toHaveLength(3);
    // A vote and a changelog link that existed before the board became a segment board.
    await inA(async (db) => {
      await db.insert(postVotes).values({
        postId: s.a.segmentPostId as PostId,
        principalId: s.me.principalId as PrincipalId,
      });
      await db.insert(changelogEntryPosts).values({
        changelogEntryId: s.a.entryId,
        postId: s.a.segmentPostId as PostId,
      });
    });
    for (const who of [{ user: env().customerA }, {}]) {
      const { list, direct } = await reads(s, who, "portal");
      for (const res of list) {
        expect(res.status).toBe(200);
        for (const value of [...hidden, s.a.segmentPostId])
          expect(res.text).not.toContain(value);
      }
      for (const [path, res] of Object.entries(direct)) {
        // A board or post the caller may not see is not found, never forbidden. A portal write
        // without a sign-in stops at the sign-in first.
        const signInFirst =
          !("user" in who) && ["vote", "follow"].includes(path) ? [401] : [];
        expect([404, ...signInFirst]).toContain(res.status);
        for (const value of [...hidden, s.a.segmentPostId])
          expect(res.text).not.toContain(value);
      }
    }
    const sitemap = await pub("/sitemap.xml");
    expect(sitemap.text).toContain("<urlset");
    expect(sitemap.text).not.toContain(s.a.segmentPostId);

    await join(s.me.principalId, s.a.segmentId);
    const { list, direct } = await reads(
      s,
      { user: env().customerA },
      "portal",
    );
    expect(list[0]!.text).toContain(hidden[0]);
    expect(list[1]!.text).toContain(hidden[1]);
    expect(list[4]!.body.postIds).toContain(s.a.segmentPostId);
    expect(list[5]!.text).toContain(hidden[1]);
    expect(direct.board.status).toBe(200);
    expect(direct.post.status).toBe(200);
    expect(direct.post.body.title).toBe(hidden[1]);
    expect(direct.comments.text).toContain(hidden[2]);
    expect(direct.vote.status).toBe(200);
    expect(direct.follow.status).toBe(200);
    expect(direct.subscription!.status).toBe(200);
    // The segment IDs stay server-side.
    expect(list[0]!.text).not.toContain(s.a.segmentId);
    // An anonymous visitor is in no segment, and the sitemap is anonymous.
    expect((await pub(`/portal/posts/${s.a.segmentPostId}`)).status).toBe(404);
    expect((await pub("/sitemap.xml")).text).not.toContain(s.a.segmentPostId);
  });

  it("hides a segment board from widget visitors outside the segment, anonymous ones included", async () => {
    const s = await scene(env(), "widget");
    const hidden = segmentText(s);
    const identified = { bearer: s.token };
    const anonymous = {
      bearer: (
        await call("POST", `/quills-public/${env().a}/widget/anonymous-session`)
      ).body.sessionToken as string,
    };
    for (const who of [identified, anonymous]) {
      const { list, direct } = await reads(s, who, "widget");
      for (const res of list) {
        expect(res.status).toBe(200);
        for (const value of [...hidden, s.a.segmentPostId])
          expect(res.text).not.toContain(value);
      }
      for (const [path, res] of Object.entries(direct))
        expect([path, res.status]).toEqual([path, 404]);
    }
    await join(s.me.principalId, s.a.segmentId);
    const member = await pub(`/widget/posts/${s.a.segmentPostId}`, identified);
    expect(member.status).toBe(200);
    expect(member.body.title).toBe(hidden[1]);
    // Even a segment row for the anonymous session's person does not admit it.
    const [person] = await inA((db) =>
      db
        .select({ id: principal.id })
        .from(principal)
        .where(eq(principal.type, "anonymous"))
        .orderBy(desc(principal.createdAt))
        .limit(1),
    );
    await join(person!.id, s.a.segmentId);
    expect(
      (await pub(`/widget/posts/${s.a.segmentPostId}`, anonymous)).status,
    ).toBe(404);
  });

  it("lets a settings manager limit a board to segments of the same workspace", async () => {
    const s = await scene(env(), "portal");
    const board = `/boards/${s.a.boardId}`;
    const [own] = await inA((db) =>
      db
        .insert(segments)
        .values({ name: "Own", slug: env().id("own") })
        .returning({ id: segments.id }),
    );
    const stored = () =>
      inA(async (db) => {
        const [row] = await db
          .select({ ids: boards.visibleSegmentIds })
          .from(boards)
          .where(eq(boards.id, s.a.boardId));
        return row!.ids;
      });

    // A segment of workspace B is not found, and the board does not change.
    const foreign = await team(board, { visibleSegmentIds: [s.b.segmentId] });
    expect(foreign.status).toBe(404);
    expect(await stored()).toBeNull();
    // A member without manage_settings and a key without that scope are denied.
    expect(
      (
        await team(
          board,
          { visibleSegmentIds: [own!.id] },
          { user: users.limited },
        )
      ).status,
    ).toBe(403);
    const scoped = await team(
      board,
      { visibleSegmentIds: [own!.id] },
      { scope: { workspace: ["read"], quills: ["read", "update"] } },
    );
    expect(scoped.status).toBe(403);
    expect(scoped.body).toMatchObject({ code: "API_KEY_SCOPE" });
    expect(
      (await team(board, { visibleSegmentIds: [own!.id] }, { user: "" }))
        .status,
    ).toBe(401);
    expect(await stored()).toBeNull();

    const saved = await team(board, {
      visibleSegmentIds: [own!.id, own!.id],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.visibleSegmentIds).toEqual([own!.id]);
    expect(await stored()).toEqual([own!.id]);
    const [event] = await inA((db) =>
      db
        .select({ type: events.type })
        .from(events)
        .where(
          and(
            eq(events.entityId, s.a.boardId),
            eq(events.type, "board.updated"),
          ),
        ),
    );
    expect(event).toEqual({ type: "board.updated" });
    // The customer is not in the new segment: the public board is gone for them.
    expect(
      (await pub(`/portal/posts/${s.a.postId}`, { user: env().customerA }))
        .status,
    ).toBe(404);

    // An empty list shows the board to everyone again.
    const cleared = await team(board, { visibleSegmentIds: [] });
    expect(cleared.body.visibleSegmentIds).toBeNull();
    expect(await stored()).toBeNull();
    expect(
      (await pub(`/portal/posts/${s.a.postId}`, { user: env().customerA }))
        .status,
    ).toBe(200);
  });
});
