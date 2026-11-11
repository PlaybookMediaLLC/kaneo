import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { BoardId, PostId, PrincipalId } from "@kaneo/ids";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import {
  postComments,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { DEFAULT_BOARD_ACCESS } from "../../database/quills/types";
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

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
const teamOnly = {
  ...DEFAULT_BOARD_ACCESS,
  view: "team",
  submit: "team",
  vote: "team",
  comment: "team",
} as const;

async function call(path: string, user?: string, teammate = false) {
  const env = contractEnv();
  const res = await app.request(
    `${teammate ? "/quills" : "/quills-public"}/${env.a}${path}`,
    { headers: user ? { "x-test-user": user } : {} },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}
const profile = (id: string, user?: string) =>
  call(`/portal/profiles/${id}`, user);
const setPortal = (config: object) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db.update(settings).set({ portalConfig: JSON.stringify(config) }),
  );

const ids: Record<string, string> = {};

describe.skipIf(!url)("Quills public profiles", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    const env = contractEnv();
    await setPortal({ enabled: true });
    await env.scoped(env.a, async (db, actor) => {
      const person = async (
        name: string,
        values: Partial<typeof principal.$inferInsert> = {},
      ) => {
        const [identity] = await db
          .insert(customer)
          .values({ name, email: `${name}@example.test` })
          .returning({ id: customer.id });
        return (
          await db
            .insert(principal)
            .values({
              userId: identity!.id,
              type: "user",
              role: "user",
              displayName: name,
              contactEmail: `contact-${name}@example.test`,
              createdAt: new Date(),
              ...values,
            })
            .returning({ id: principal.id })
        )[0]!.id;
      };
      const [open, team] = await db
        .insert(boards)
        .values([
          { name: "Open", slug: env.id("open") },
          { name: "Team", slug: env.id("team"), access: teamOnly },
        ])
        .returning({ id: boards.id });
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.isDefault, true));
      const post = async (
        title: string,
        principalId: PrincipalId,
        values: Partial<typeof posts.$inferInsert> = {},
      ) =>
        (
          await db
            .insert(posts)
            .values({
              title,
              content: title,
              boardId: open!.id as BoardId,
              principalId,
              statusId: status!.id,
              ...values,
            })
            .returning({ id: posts.id })
        )[0]!.id;
      const x = await person("xavier");
      ids.x = x;
      await post("x-public", x);
      await post("x-team-board", x, { boardId: team!.id as BoardId });
      await post("x-held", x, { moderationState: "pending" });
      await post("x-deleted", x, { deletedAt: new Date() });
      const comment = async (
        title: string,
        values: Partial<typeof postComments.$inferInsert> = {},
      ) => {
        const postId: PostId = await post(title, actor.principalId);
        await db
          .insert(postComments)
          .values({ postId, principalId: x, content: title, ...values });
      };
      await comment("commented-public");
      await comment("commented-private", { isPrivate: true });
      await comment("commented-held", { moderationState: "pending" });
      await comment("commented-deleted", { deletedAt: new Date() });
      await db.insert(postVotes).values({
        postId: await post("voted-post", actor.principalId),
        principalId: x,
      });
      ids.blocked = await person("blocked", { blockedAt: new Date() });
      await post("blocked-post", ids.blocked as PrincipalId);
      ids.tester = await person("tester", {
        testOwnerPrincipalId: await person("test-owner"),
      });
      await post("tester-post", ids.tester as PrincipalId);
      ids.quiet = await person("quiet");
      await post("quiet-team-post", ids.quiet as PrincipalId, {
        boardId: team!.id as BoardId,
      });
      ids.removed = await person("removed");
      await db.delete(principal).where(eq(principal.id, ids.removed as never));
    });
    await env.scoped(env.b, async (db, actor) => {
      const [board] = await db
        .insert(boards)
        .values({ name: "Open B", slug: env.id("open-b") })
        .returning({ id: boards.id });
      const [status] = await db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.isDefault, true));
      await db.insert(posts).values({
        title: "foreign-post",
        content: "-",
        boardId: board!.id,
        principalId: actor.principalId,
        statusId: status!.id,
      });
      ids.foreign = actor.principalId;
    });
  }, 120000);
  afterAll(() => stopContract());

  it("shows only public fields and the activity that the caller can see", async () => {
    const res = await profile(ids.x!);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "avatarUrl",
        "commentCount",
        "comments",
        "displayName",
        "isTeamMember",
        "joinedAt",
        "postCount",
        "posts",
        "principalId",
      ].sort(),
    );
    expect(res.body).toMatchObject({
      displayName: "xavier",
      isTeamMember: false,
      postCount: 1,
      commentCount: 1,
    });
    expect(res.body.posts.map((p: { title: string }) => p.title)).toEqual([
      "x-public",
    ]);
    expect(res.body.comments.map((p: { title: string }) => p.title)).toEqual([
      "commented-public",
    ]);
    const text = JSON.stringify(res.body);
    for (const hidden of [
      "xavier@example.test",
      "contact-xavier",
      "x-team-board",
      "x-held",
      "x-deleted",
      "commented-private",
      "commented-held",
      "commented-deleted",
      "voted-post",
    ])
      expect(text).not.toContain(hidden);
  });

  it("answers 404 alike for blocked, test, removed, unknown, foreign and quiet people", async () => {
    const unknown = await profile(ids.removed!.replace(/.$/, "0"));
    expect(unknown.status).toBe(404);
    for (const id of [
      ids.blocked,
      ids.tester,
      ids.quiet,
      ids.removed,
      ids.foreign,
    ]) {
      const res = await profile(id!);
      expect(res).toEqual(unknown);
    }
  });

  it("respects the portal switch and the private-portal gate", async () => {
    try {
      await setPortal({ enabled: false });
      expect((await profile(ids.x!)).status).toBe(404);
      await setPortal({ enabled: true, access: { visibility: "private" } });
      expect((await profile(ids.x!)).status).toBe(403);
      expect((await profile(ids.x!, contractEnv().owner)).status).toBe(200);
    } finally {
      await setPortal({ enabled: true });
    }
  });

  it("gives the team context to teammates only", async () => {
    const env = contractEnv();
    const context = await call(
      `/profiles/${ids.x}/team-context`,
      env.owner,
      true,
    );
    expect(context.status).toBe(200);
    expect(context.body).toEqual({
      email: "xavier@example.test",
      company: null,
      segments: [],
      lastSeenAt: null,
      emailVerified: false,
      blocked: false,
    });
    expect(
      (await call(`/profiles/${ids.blocked}/team-context`, env.owner, true))
        .body.blocked,
    ).toBe(true);
    for (const id of [ids.tester, ids.removed, ids.foreign])
      expect(
        (await call(`/profiles/${id}/team-context`, env.owner, true)).status,
      ).toBe(404);
    // A portal customer has no membership, so the teammate route refuses it.
    expect([403, 404]).toContain(
      (await call(`/profiles/${ids.x}/team-context`, env.customerA, true))
        .status,
    );
  });
});
