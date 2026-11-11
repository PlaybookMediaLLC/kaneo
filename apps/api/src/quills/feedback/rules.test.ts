import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import { boards, postTags } from "../../database/quills/schema/boards";
import {
  postCommentEditHistory,
  posts,
} from "../../database/quills/schema/posts";
import { segments } from "../../database/quills/schema/segments";
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
let customer: TypeId<"principal">;
let memberPrincipal: TypeId<"principal">;
let n = 0;

const owner = () => world.users.owner;
const send = (method: string, path: string, body?: unknown, user = owner()) =>
  world.request(user, method, path, body);
const newPost = async (board = boardId) =>
  (await send("POST", "/posts", { boardId: board, title: `Rule ${++n}` })).body
    .id as string;
const comment = async (postId: string, body: object) =>
  (await send("POST", `/posts/${postId}/comments`, body)).body;
const commentCount = async (postId: string) =>
  (await send("GET", `/posts/${postId}`)).body.commentCount;

describe.skipIf(!url)("Feedback rules", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "rules");
    ({ boardId, customer } = await world.scoped(
      world.a,
      owner(),
      async (db) => {
        const [board] = await db
          .insert(boards)
          .values({ name: "Rules", slug: `rules-${Date.now()}` })
          .returning({ id: boards.id });
        const [person] = await db
          .insert(principal)
          .values({ type: "user", role: "user", createdAt: new Date() })
          .returning({ id: principal.id });
        return { boardId: board!.id, customer: person!.id };
      },
    ));
    memberPrincipal = await world.scoped(
      world.a,
      world.users.member,
      async (_db, actor) => actor.principalId,
    );
  }, 120000);
  afterAll(() => world?.stop());

  it("deletes and restores a comment in both directions, moving the count", async () => {
    const postId = await newPost();
    const created = await comment(postId, { content: "Secret words" });
    expect(await commentCount(postId)).toBe(1);
    const path = `/comments/${created.id}`;
    expect((await send("DELETE", path)).status).toBe(200);
    expect(await commentCount(postId)).toBe(0);
    expect((await send("GET", path)).status).toBe(404);
    const thread = (await send("GET", `/posts/${postId}/comments`)).body.items;
    expect(thread[0].content).toBe("");
    expect(JSON.stringify(thread)).not.toContain("Secret words");
    expect((await send("POST", `${path}/restore`)).body.content).toBe(
      "Secret words",
    );
    expect(await commentCount(postId)).toBe(1);
    expect((await send("POST", `${path}/restore`)).status).toBe(409);
  });

  it("moves the count once when the same comment is deleted in parallel", async () => {
    const postId = await newPost();
    const content = `Twice ${++n}`;
    const created = await comment(postId, { content });
    await comment(postId, { content: "Stays" });
    // Hold the row so both requests read it as active and then wait at their UPDATE.
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query(
        "SELECT 1 FROM quills.post_comments WHERE content = $1 FOR UPDATE",
        [content],
      );
      const deletes = [1, 2].map(() =>
        send("DELETE", `/comments/${created.id}`),
      );
      for (let tries = 0; tries < 100; tries++) {
        const { rows } = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if (rows[0].n >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await lock.query("COMMIT");
      const results = await Promise.all(deletes);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    } finally {
      lock.release();
    }
    expect(await commentCount(postId)).toBe(1);
  });

  it("keeps internal comments and their replies out of the public count", async () => {
    const postId = await newPost();
    const internal = await comment(postId, {
      content: "Internal",
      isPrivate: true,
    });
    expect(internal.isPrivate).toBe(true);
    const reply = await comment(postId, {
      content: "Reply",
      parentId: internal.id,
    });
    expect(reply.isPrivate).toBe(true);
    expect(await commentCount(postId)).toBe(0);
    await send("DELETE", `/comments/${internal.id}`);
    expect(await commentCount(postId)).toBe(0);
    await comment(postId, { content: "Public" });
    expect(await commentCount(postId)).toBe(1);
    const other = await comment(await newPost(), { content: "Elsewhere" });
    expect(
      (
        await send("POST", `/posts/${postId}/comments`, {
          content: "Wrong parent",
          parentId: other.id,
        })
      ).status,
    ).toBe(404);
  });

  it("records an edit of another author's comment with its editor", async () => {
    const postId = await newPost();
    const created = await comment(postId, { content: "Original" });
    const edited = await send(
      "PATCH",
      `/comments/${created.id}`,
      { content: "Moderated" },
      world.users.member,
    );
    expect(edited.body).toMatchObject({
      content: "Moderated",
      principalId: created.principalId,
    });
    const history = await world.scoped(world.a, owner(), (db) =>
      db
        .select({
          editor: postCommentEditHistory.editorPrincipalId,
          previous: postCommentEditHistory.previousContent,
        })
        .from(postCommentEditHistory)
        .where(eq(postCommentEditHistory.commentId, created.id)),
    );
    expect(history).toEqual([
      { editor: memberPrincipal, previous: "Original" },
    ]);
  });

  it("pins only a public root teammate comment of the same post", async () => {
    const postId = await newPost();
    const root = await comment(postId, { content: "Answer" });
    const reply = await comment(postId, {
      content: "Reply",
      parentId: root.id,
    });
    const internal = await comment(postId, {
      content: "Note",
      isPrivate: true,
    });
    const elsewhere = await comment(await newPost(), { content: "Other" });
    const pin = (id: string, method = "PUT") =>
      send(method, `/posts/${postId}/pinned-comment/${id}`);
    expect((await pin(root.id)).body).toEqual({ changed: true });
    expect((await pin(root.id)).body).toEqual({ changed: false });
    expect((await pin(elsewhere.id)).status).toBe(404);
    expect((await pin(reply.id)).status).toBe(409);
    expect((await pin(internal.id)).status).toBe(409);
    expect((await send("GET", `/posts/${postId}`)).body.pinnedCommentId).toBe(
      root.id,
    );
    await send("DELETE", `/comments/${root.id}`);
    expect(
      (await send("GET", `/posts/${postId}`)).body.pinnedCommentId,
    ).toBeNull();
    expect((await pin(root.id, "DELETE")).body).toEqual({ changed: false });
  });

  it("assigns only current teammates as owners and clears the owner", async () => {
    const postId = await newPost();
    const path = `/posts/${postId}/owner`;
    expect(
      (await send("PUT", path, { ownerPrincipalId: customer })).status,
    ).toBe(404);
    expect(
      (await send("PUT", path, { ownerPrincipalId: memberPrincipal })).body
        .ownerPrincipalId,
    ).toBe(memberPrincipal);
    expect(
      (await send("PUT", path, { ownerPrincipalId: null })).body
        .ownerPrincipalId,
    ).toBeNull();
    const activity = (await send("GET", `/posts/${postId}/activity`)).body
      .items;
    expect(
      activity.slice(0, 2).map((row: { type: string }) => row.type),
    ).toEqual(["owner.unassigned", "owner.assigned"]);
    const candidates = (
      await send("GET", "/posts/owner-candidates")
    ).body.items.map((row: { principalId: string }) => row.principalId);
    expect(candidates).toContain(memberPrincipal);
    expect(candidates).not.toContain(customer);
  });

  it("pages every sort without gaps or repeats, also with equal timestamps", async () => {
    // One transaction, so all five posts share created_at; vote counts tie in pairs.
    const { board, expected } = await world.scoped(
      world.a,
      owner(),
      async (db, actor) => {
        const [row] = await db
          .insert(boards)
          .values({ name: "Paging", slug: `paging-${Date.now()}` })
          .returning({ id: boards.id });
        const rows = await db
          .insert(posts)
          .values(
            [0, 1, 1, 2, 2].map((voteCount, i) => ({
              title: `Page ${i}`,
              content: "",
              boardId: row!.id,
              principalId: actor.principalId,
              voteCount,
            })),
          )
          .returning({ id: posts.id });
        return { board: row!.id, expected: rows.map((r) => r.id).sort() };
      },
    );
    for (const sort of ["newest", "oldest", "votes"]) {
      const seen: { id: string; voteCount: number }[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: {
          items: { id: string; voteCount: number }[];
          nextCursor: string | null;
          hasMore: boolean;
        } = (
          await send(
            "GET",
            `/posts?boardIds=${board}&sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
          )
        ).body;
        seen.push(...page.items);
        cursor = page.nextCursor;
        expect(page.hasMore).toBe(cursor !== null);
      } while (cursor && ++pages < 10);
      expect(seen.map((post) => post.id).sort(), sort).toEqual(expected);
      if (sort === "votes")
        expect(seen.map((post) => post.voteCount)).toEqual([2, 2, 1, 1, 0]);
    }
  });

  it("rejects foreign IDs and broken access rules inside request bodies", async () => {
    const foreign = await world.scoped(
      world.b,
      world.users.outsider,
      async (db) => {
        const [tag] = await db
          .insert(postTags)
          .values({ name: `foreign-${Date.now()}` })
          .returning({ id: postTags.id });
        const [segment] = await db
          .insert(segments)
          .values({ name: "Foreign", slug: `foreign-${Date.now()}` })
          .returning({ id: segments.id });
        return { tag: tag!.id, segment: segment!.id };
      },
    );
    const postsOnBoard = () =>
      world.scoped(world.a, owner(), async (db) => {
        const [row] = await db
          .select({ n: count() })
          .from(posts)
          .where(eq(posts.boardId, boardId));
        return row!.n;
      });
    const before = await postsOnBoard();
    expect(
      (
        await send("POST", "/posts", {
          boardId,
          title: "Foreign tag",
          tagIds: [foreign.tag],
        })
      ).status,
    ).toBe(404);
    expect(await postsOnBoard()).toBe(before);
    const access = {
      view: "anonymous",
      vote: "anonymous",
      comment: "anonymous",
      submit: "segments",
      segments: { view: [], vote: [], comment: [], submit: [foreign.segment] },
      moderation: {
        anonPosts: "inherit",
        signedPosts: "inherit",
        comments: "inherit",
      },
    };
    const board = (patch: object) =>
      send("POST", "/boards", {
        name: "Access",
        access: { ...access, ...patch },
      });
    expect((await board({})).status).toBe(404);
    expect((await board({ view: "team" })).status).toBe(400);
    expect(
      (
        await board({
          segments: { view: [], vote: [], comment: [], submit: [] },
        })
      ).status,
    ).toBe(400);
  });
});
