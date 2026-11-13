import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { eq, inArray } from "drizzle-orm";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { conversationMessages } from "../../database/quills/schema/conversation";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../database/quills/schema/kb";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import { tickets, ticketStatuses } from "../../database/quills/schema/tickets";
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
  // Matched only through a deleted message: never found, and its text never shows.
  const quiet = await conversation(db, actor.principalId, visitor, {
    subject: "Quiet",
  });
  await db.insert(conversationMessages).values({
    conversationId: quiet.conversationId,
    principalId: actor.principalId,
    senderType: "agent",
    content: "the zebra secret",
    deletedAt: new Date(),
  });
  const [status] = await db
    .select({ id: ticketStatuses.id })
    .from(ticketStatuses)
    .where(eq(ticketStatuses.isDefault, true))
    .limit(1);
  const ticket = async (
    title: string,
    values: Partial<typeof tickets.$inferInsert> = {},
  ) =>
    (
      await db
        .insert(tickets)
        .values({
          title,
          statusId: status!.id,
          requesterPrincipalId: visitor,
          ...values,
        })
        .returning({ id: tickets.id })
    )[0]!.id;
  const [category] = await db
    .insert(helpCenterCategories)
    .values({ name: "Search", slug: `search-${Date.now()}-${Math.random()}` })
    .returning({ id: helpCenterCategories.id });
  const article = async (title: string, deletedAt?: Date) =>
    (
      await db
        .insert(helpCenterArticles)
        .values({
          categoryId: category!.id,
          title,
          slug: `article-${Date.now()}-${Math.random()}`,
          content: title,
          principalId: actor.principalId,
          deletedAt,
        })
        .returning({ id: helpCenterArticles.id })
    )[0]!.id;
  const entry = async (title: string, deletedAt?: Date) =>
    (
      await db
        .insert(changelogEntries)
        .values({
          title,
          content: title,
          principalId: actor.principalId,
          deletedAt,
        })
        .returning({ id: changelogEntries.id })
    )[0]!.id;
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
    quiet: quiet.conversationId,
    ticket: await ticket("Zebra ticket"),
    goneTicket: await ticket("Zebra ticket gone", { deletedAt: new Date() }),
    testTicket: await ticket("Zebra ticket test", {
      requesterPrincipalId: tester,
    }),
    article: await article("Zebra guide"),
    goneArticle: await article("Zebra guide gone", new Date()),
    entry: await entry("Zebra release"),
    goneEntry: await entry("Zebra release gone", new Date()),
  };
}

describe.skipIf(!url)("Workspace search visibility", () => {
  let a: Awaited<ReturnType<typeof side>>;
  let b: Awaited<ReturnType<typeof side>>;
  let formerTeammate: string;

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
    // A third member, so three teammates tie on the "starts with" tier, and a former member whose
    // actor stays for history. world.stop() removes both accounts.
    const prefix = users.owner.replace(/_owner$/, "");
    const extra = `${prefix}_extra`;
    const former = `${prefix}_former`;
    await world.db.insert(kaneo.userTable).values(
      [extra, former].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
      })),
    );
    Object.assign(users, { extra, former });
    await world.db.insert(kaneo.workspaceUserTable).values(
      [extra, former].map((userId) => ({
        workspaceId: world.a,
        userId,
        role: "member",
        joinedAt: new Date(),
      })),
    );
    for (const user of [users.member, extra])
      await world.scoped(world.a, user, async () => {});
    // Actors get random IDs. Give the lowest ID the oldest time, so a tie order by age would
    // disagree with the merge's order by ID.
    await world.scoped(world.a, users.owner, async (db) => {
      const mates = await db
        .select({ id: principal.id })
        .from(principal)
        .where(
          inArray(principal.kaneoUserId, [users.owner, users.member, extra]),
        )
        .orderBy(principal.id);
      for (const [index, mate] of mates.entries())
        await db
          .update(principal)
          .set({ createdAt: new Date(Date.now() - (3 - index) * 60000) })
          .where(eq(principal.id, mate.id));
    });
    formerTeammate = await world.scoped(
      world.a,
      former,
      async (_db, actor) => actor.principalId,
    );
    await world.db
      .delete(kaneo.workspaceUserTable)
      .where(eq(kaneo.workspaceUserTable.userId, former));
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
      expect.arrayContaining([
        a.openPost,
        a.real,
        a.byMessage,
        a.ticket,
        a.article,
        a.entry,
      ]),
    );
    for (const id of [
      ...a.hiddenPosts,
      a.test,
      a.spam,
      a.quiet,
      a.goneTicket,
      a.testTicket,
      a.goneArticle,
      a.goneEntry,
      ...b.hiddenPosts,
      b.openPost,
      b.real,
      b.byMessage,
      b.ticket,
      b.article,
      b.entry,
    ])
      expect(foundIds).not.toContain(id);
    // A deleted message's text never reaches an excerpt.
    expect(JSON.stringify(found)).not.toContain("secret");
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
    for (const id of [b.teammate, formerTeammate])
      expect(teammates).not.toContain(id);
  });

  it("pages each kind without a repeat or a gap", async () => {
    const { owner } = world.users;
    // Four posts: three tie on score and update time, so the ID decides their order.
    const first = await search(owner, "q=zebra&kind=post&limit=1");
    expect(first.hasMore).toBe(true);
    const rest = await search(owner, "q=zebra&kind=post&offset=1&limit=3");
    expect(rest.hasMore).toBe(false);
    const posts = [...ids(first), ...ids(rest)];
    expect(new Set(posts).size).toBe(4);
    expect(posts.sort()).toEqual([...a.hiddenPosts, a.openPost].sort());
    // Three current teammates tie on the "starts with" tier.
    const prefix = owner.replace(/_owner$/, "");
    const teammates: string[] = [];
    for (const offset of [0, 1, 2])
      teammates.push(
        ...ids(
          await search(
            owner,
            `q=${prefix}&kind=teammate&limit=1&offset=${offset}`,
          ),
        ),
      );
    expect(new Set(teammates).size).toBe(3);
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
