import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { boards } from "../../database/quills/schema/boards";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import * as kaneo from "../../database/schema";
import type { Database, QuillsActor } from "../framework/define-route";
import { startFeature } from "../feedback/harness.fixture";
import { conversation, customer } from "../support/conversation-seed.fixture";
import { searchExcerpt } from "./search-match";

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

describe("searchExcerpt", () => {
  it("keeps short text and cuts long text around the first matched word", () => {
    expect(
      searchExcerpt("  A **short** [note](https://x.test)  ", "note"),
    ).toBe("A short note");
    const long = `${"filler ".repeat(60)}the zebra invoice ${"tail ".repeat(60)}`;
    const excerpt = searchExcerpt(long, "Zebra");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).toContain("zebra invoice");
    expect(excerpt.length).toBeLessThanOrEqual(202);
  });
});

/** Seeds one workspace: a board per project link, posts, and conversations. */
async function side(
  db: Database,
  actor: QuillsActor,
  hiddenProject?: string,
  openProject?: string,
) {
  const board = async (label: string, projectId?: string) => {
    const [row] = await db
      .insert(boards)
      .values({ name: label, slug: `${label}-${Date.now()}-${Math.random()}` })
      .returning({ id: boards.id });
    if (projectId)
      await db.insert(boardProjects).values({ boardId: row!.id, projectId });
    return row!.id;
  };
  const post = async (boardId: TypeId<"board">, title: string) =>
    (
      await db
        .insert(posts)
        .values({
          title,
          content: title,
          boardId,
          principalId: actor.principalId,
        })
        .returning({ id: posts.id })
    )[0]!.id;
  const hidden = await board("search-hidden", hiddenProject);
  const open = await board("search-open", openProject);
  // An exact title ranks above "starts with": hidden posts outrank the open one.
  const hiddenPosts = [
    await post(hidden, "zebra"),
    await post(hidden, "zebra"),
    await post(hidden, "zebra"),
  ];
  const openPost = await post(open, "Zebra crossing notes");
  const visitor = await customer(
    db,
    `search-${Date.now()}-${Math.random()}@example.test`,
  );
  const tester = await customer(
    db,
    `search-test-${Date.now()}-${Math.random()}@example.test`,
    actor.principalId,
  );
  const real = await conversation(db, actor.principalId, visitor, {
    subject: "Zebra refund",
  });
  const byMessage = await conversation(db, actor.principalId, visitor, {
    subject: "Billing",
  });
  const test = await conversation(db, actor.principalId, tester, {
    subject: "Zebra test",
  });
  const spam = await conversation(db, actor.principalId, visitor, {
    subject: "Zebra spam",
    status: "closed",
    endReason: "spam",
    spamReason: "manual",
    resolvedAt: new Date(),
  });
  return {
    visitor,
    tester,
    teammate: actor.principalId,
    hiddenPosts,
    openPost,
    real: real.conversationId,
    byMessage: byMessage.conversationId,
    test: test.conversationId,
    spam: spam.conversationId,
  };
}

describe.skipIf(!url)("Workspace search visibility", () => {
  let a: Awaited<ReturnType<typeof side>>;
  let b: Awaited<ReturnType<typeof side>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "search");
    const { users, projects } = world;
    a = await world.scoped(world.a, users.owner, async (db, actor) => {
      const ids = await side(db, actor, projects.hidden, projects.open);
      // Matched only through a message: "the zebra invoice".
      await db.insert(conversationMessages).values({
        conversationId: ids.byMessage as never,
        principalId: actor.principalId,
        senderType: "agent",
        content: "We sent the zebra invoice again",
      });
      return ids;
    });
    b = await world.scoped(world.b, users.outsider, (db, actor) =>
      side(db, actor),
    );
  }, 120000);
  afterAll(() => world?.stop());

  const search = async (user: string, query: string) => {
    const res = await world.request(user, "GET", `/search?${query}`);
    expect(res.status).toBe(200);
    return res.body as {
      results: { kind: string; id: string; excerpt: string | null }[];
      hasMore: boolean;
    };
  };
  const ids = (page: { results: { id: string }[] }) =>
    page.results.map((result) => result.id);

  it("filters hidden boards before the limit", async () => {
    const { member, owner } = world.users;
    const page = await search(member, "q=zebra&kind=post&limit=1");
    // Three hidden posts rank higher; the filter runs first, so the one row is the open post.
    expect(ids(page)).toEqual([a.openPost]);
    expect(page.hasMore).toBe(false);
    const all = ids(await search(owner, "q=zebra&kind=post&limit=50"));
    expect(all.slice(0, 3).sort()).toEqual([...a.hiddenPosts].sort());
    expect(all).toContain(a.openPost);
  });

  it("finds only records that the caller's lists show", async () => {
    const { member, owner } = world.users;
    const found = await search(member, "q=zebra&limit=50");
    const foundIds = ids(found);
    expect(foundIds).toEqual(
      expect.arrayContaining([a.openPost, a.real, a.byMessage]),
    );
    for (const id of [
      ...a.hiddenPosts,
      a.test,
      a.spam,
      ...b.hiddenPosts,
      b.openPost,
      b.real,
      b.byMessage,
    ])
      expect(foundIds).not.toContain(id);
    // The owner sees the hidden board, never workspace B.
    const ownerIds = ids(await search(owner, "q=zebra&limit=50"));
    expect(ownerIds).toEqual(expect.arrayContaining(a.hiddenPosts));
    for (const id of [b.openPost, b.real, ...b.hiddenPosts])
      expect(ownerIds).not.toContain(id);
    // A message match carries its excerpt.
    expect(
      found.results.find((result) => result.id === a.byMessage)?.excerpt,
    ).toContain("zebra invoice");
  });

  it("finds customers and current teammates of this workspace only", async () => {
    const { member, owner } = world.users;
    const people = ids(
      await search(member, "q=support%20customer&kind=person&limit=50"),
    );
    expect(people).toContain(a.visitor);
    for (const id of [a.tester, b.visitor, b.tester])
      expect(people).not.toContain(id);
    // Every account of this world shares the prefix; B's owner is not a member of A.
    const prefix = owner.replace(/_owner$/, "");
    const teammates = ids(
      await search(member, `q=${prefix}&kind=teammate&limit=50`),
    );
    expect(teammates).toContain(a.teammate);
    expect(teammates).not.toContain(b.teammate);
  });

  it("finds nothing for a one-character query and stops at 100", async () => {
    const { owner } = world.users;
    expect(await search(owner, "q=z")).toEqual({ results: [], hasMore: false });
    expect(await search(owner, "q=zebra&offset=100")).toEqual({
      results: [],
      hasMore: false,
    });
    expect(
      (await world.request(owner, "GET", "/search?q=zebra&offset=101")).status,
    ).toBe(400);
  });
});
