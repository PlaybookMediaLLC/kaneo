import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { maintainPageViewPartitions } from "../../database/quills/page-view-partitions";
import { principal, user } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { boardProjects } from "../../database/quills/schema/platform-links";
import {
  postComments,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { pageViews } from "../../database/quills/schema/visitor-analytics";
import * as kaneo from "../../database/schema";
import { startFeature } from "../feedback/harness.fixture";
import { runQuillsRetention } from "../jobs/retention";

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
let hiddenPost: TypeId<"post">;
let hiddenBoard: TypeId<"board">;

describe.skipIf(!url)("Reporting aggregates", () => {
  // Posts: hidden (board linked to the private project), open, plain, plus a test customer's post
  // and a deleted post on the plain board. The member can open only the open project.
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "reporting");
    const { a, users, projects } = world;
    await world.scoped(a, users.owner, async (db, actor) => {
      const board = async (label: string) =>
        (
          await db
            .insert(boards)
            .values({ name: label, slug: `${label}-${Date.now()}` })
            .returning({ id: boards.id })
        )[0]!.id;
      hiddenBoard = await board("Hidden");
      const open = await board("Open");
      const plain = await board("Plain");
      await db.insert(boardProjects).values([
        { boardId: hiddenBoard, projectId: projects.hidden },
        { boardId: open, projectId: projects.open },
      ]);
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.isDefault, true));
      // Both have an account, so only the test-customer rule keeps the tester out of signups.
      const person = async (test: boolean) => {
        const name = test ? "Tester" : "Customer";
        const [profile] = await db
          .insert(user)
          .values({ name, email: `${name}-${Date.now()}@example.test` })
          .returning({ id: user.id });
        return (
          await db
            .insert(principal)
            .values({
              userId: profile!.id,
              type: "user",
              role: "user",
              displayName: name,
              createdAt: new Date(),
              testOwnerPrincipalId: test ? actor.principalId : null,
            })
            .returning({ id: principal.id })
        )[0]!.id;
      };
      const customer = await person(false);
      const tester = await person(true);
      const post = async (
        boardId: TypeId<"board">,
        title: string,
        extra = {},
      ) =>
        (
          await db
            .insert(posts)
            .values({
              title,
              content: title,
              boardId,
              principalId: actor.principalId,
              statusId: status!.id,
              ...extra,
            })
            .returning({ id: posts.id })
        )[0]!.id;
      hiddenPost = await post(hiddenBoard, "Hidden idea");
      const openPost = await post(open, "Open idea");
      await post(plain, "Plain idea");
      await post(plain, "Tester idea", { principalId: tester });
      await post(plain, "Deleted idea", { deletedAt: new Date() });
      await db.insert(postVotes).values([
        { postId: hiddenPost, principalId: customer },
        { postId: openPost, principalId: customer },
        { postId: openPost, principalId: tester },
      ]);
      await db.insert(postComments).values([
        { postId: hiddenPost, principalId: customer, content: "Hidden" },
        { postId: openPost, principalId: customer, content: "Open" },
        { postId: openPost, principalId: tester, content: "Test" },
      ]);
    });
  }, 120000);
  afterAll(() => world?.stop());

  const analytics = async (user: string) =>
    (await world.request(user, "GET", "/reporting/analytics?period=7d")).body;

  it("counts only posts, votes and comments on boards the caller can see, without test data", async () => {
    const member = await analytics(world.users.member);
    expect(member.summary.posts.total).toBe(2);
    expect(member.summary.votes.total).toBe(1);
    expect(member.summary.comments.total).toBe(1);
    expect(member.summary.users.total).toBe(1);
    expect(
      member.dailyStats.reduce(
        (n: number, d: { posts: number }) => n + d.posts,
        0,
      ),
    ).toBe(2);
    expect(
      member.statusDistribution.reduce(
        (n: number, s: { count: number }) => n + s.count,
        0,
      ),
    ).toBe(2);
    const text = JSON.stringify(member);
    expect(text).not.toContain(hiddenPost);
    expect(text).not.toContain(hiddenBoard);
    expect(text).not.toContain("Hidden idea");
    expect(text).not.toContain("Tester idea");
    expect(text).not.toContain("Deleted idea");
    expect(member.topPosts[0]).toMatchObject({
      title: "Open idea",
      voteCount: 1,
      commentCount: 1,
    });

    const owner = await analytics(world.users.owner);
    expect(owner.summary.posts.total).toBe(3);
    expect(owner.summary.votes.total).toBe(2);
    expect(JSON.stringify(owner.boardBreakdown)).toContain(hiddenBoard);
  });

  it("keeps hidden boards out of the admin overview", async () => {
    const res = await world.request(
      world.users.member,
      "GET",
      "/reporting/admin-overview",
    );
    expect(res.status).toBe(200);
    expect(res.body.feedback.reviewCount).toBe(2);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(hiddenPost);
    expect(text).not.toContain("Tester idea");
    expect(res.body.momentum).toEqual([
      expect.objectContaining({ title: "Open idea", votesLast7d: 1 }),
    ]);
    const owner = await world.request(
      world.users.owner,
      "GET",
      "/reporting/admin-overview",
    );
    expect(owner.body.feedback.reviewCount).toBe(3);
  });

  it("leaves test customers' page views out of the visitor rollup", async () => {
    await maintainPageViewPartitions(url!);
    await withQuillsSystemWorkspace(world.a, async (db) => {
      const [tester] = await db
        .select({ id: principal.id })
        .from(principal)
        .where(eq(principal.displayName, "Tester"));
      const view = (
        visitorHash: string,
        path: string,
        principalId = null as null | TypeId<"principal">,
      ) => ({
        siteOrigin: "https://portal.example.test",
        surface: "portal" as const,
        path,
        visitorHash,
        principalId,
        occurredAt: new Date(),
      });
      await db
        .insert(pageViews)
        .values([
          view("one", "/"),
          view("one", "/ideas"),
          view("two", "/"),
          view("test", "/secret-test-page", tester!.id),
        ]);
    });
    // The hourly retention pass runs the rollup for every workspace.
    expect(await runQuillsRetention()).toEqual({ degraded: false });
    const res = await world.request(
      world.users.member,
      "GET",
      "/reporting/visitor-analytics?period=7d&surface=portal",
    );
    expect(res.status).toBe(200);
    expect(res.body.uniqueVisitors.current).toBe(2);
    expect(res.body.pageviews.current).toBe(3);
    expect(res.body.top.page.map((p: { label: string }) => p.label)).toEqual([
      "/",
      "/ideas",
    ]);
    expect(JSON.stringify(res.body)).not.toContain("secret-test-page");
    const outsider = await world.request(
      world.users.outsider,
      "GET",
      "/reporting/visitor-analytics?period=7d&surface=portal",
    );
    expect([403, 404]).toContain(outsider.status);
  });

  it("lists the most viewed published changelog entries up to changelogLimit", async () => {
    const day = 86_400_000;
    const published = new Date(Date.now() - day);
    const read = (title: string, viewCount: number) => ({
      title,
      content: "-",
      viewCount,
      publishedAt: published,
    });
    await world.scoped(world.a, world.users.owner, (db) =>
      db.insert(changelogEntries).values([
        read("Read 60", 60),
        read("Read 50", 50),
        read("Read 40", 40),
        read("Read 30", 30),
        read("Read 20", 20),
        read("Read 10", 10),
        { title: "Draft entry", content: "-", viewCount: 99 },
        {
          ...read("Scheduled entry", 98),
          publishedAt: new Date(Date.now() + day),
        },
        { ...read("Deleted entry", 97), deletedAt: new Date() },
      ]),
    );
    const titles = async (query: string) =>
      (
        await world.request(
          world.users.member,
          "GET",
          `/reporting/analytics?period=7d${query}`,
        )
      ).body.changelog.topEntries.map((e: { title: string }) => e.title);
    const res = await world.request(
      world.users.member,
      "GET",
      "/reporting/analytics?period=7d&changelogLimit=2",
    );
    expect(res.status).toBe(200);
    expect(res.body.changelog.topEntries).toEqual([
      expect.objectContaining({
        title: "Read 60",
        viewCount: 60,
        publishedAt: published.toISOString(),
      }),
      expect.objectContaining({ title: "Read 50", viewCount: 50 }),
    ]);
    // The default stays five, as before the limit existed.
    expect(await titles("")).toEqual([
      "Read 60",
      "Read 50",
      "Read 40",
      "Read 30",
      "Read 20",
    ]);
    expect(await titles("&changelogLimit=20")).toHaveLength(6);
    for (const limit of ["0", "21"])
      expect(
        (
          await world.request(
            world.users.member,
            "GET",
            `/reporting/analytics?changelogLimit=${limit}`,
          )
        ).status,
      ).toBe(400);
    expect([403, 404]).toContain(
      (await world.request(world.users.outsider, "GET", "/reporting/analytics"))
        .status,
    );
  });
});
