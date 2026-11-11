import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostCommentId, PostViewId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { postComments } from "../../database/quills/schema/posts";
import { postViews } from "../../database/quills/schema/post-views";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import { postIn } from "./seeds.fixture";
import {
  call,
  removeMembers,
  restrictedMember,
} from "./taxonomy-harness.fixture";

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
// An API key that holds every Quills action except delete.
const noDelete = {
  workspace: ["read"],
  quills: ["read", "create", "update", "manage_settings"],
};

/** A DELETE as `user` through an API key with `scope`. */
async function withKey(user: string, path: string, scope: object) {
  const res = await app.request(`/quills/${contractEnv().a}${path}`, {
    method: "DELETE",
    headers: { "x-test-user": user, "x-test-scope": JSON.stringify(scope) },
  });
  return { status: res.status, body: await res.json() };
}
const commentDeleted = async (id: PostCommentId) =>
  contractEnv().scoped(contractEnv().a, async (db) => {
    const [row] = await db
      .select({ deletedAt: postComments.deletedAt })
      .from(postComments)
      .where(eq(postComments.id, id));
    return row!.deletedAt !== null;
  });
const viewDeleted = async (id: PostViewId) =>
  contractEnv().scoped(contractEnv().a, async (db) => {
    const [row] = await db
      .select({ deletedAt: postViews.deletedAt })
      .from(postViews)
      .where(eq(postViews.id, id));
    return row!.deletedAt !== null;
  });

describe.skipIf(!url)("Quills own-record actions", () => {
  let member: string;
  let admin: string | undefined;
  let postId: string;
  const comment = async (user: string) =>
    (
      await call(
        app,
        contractEnv(),
        user,
        "POST",
        `/posts/${postId}/comments`,
        {
          content: "A comment",
        },
      )
    ).body.id as PostCommentId;
  const view = async (user: string) =>
    (
      await call(app, contractEnv(), user, "POST", "/post-views", {
        name: "Mine",
        filters: {},
      })
    ).body.id as PostViewId;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    const env = await startContract(pool, url!);
    // The built-in member role holds quills read, create and update, not delete.
    member = await restrictedMember(env, []);
    postId = (await postIn(env, env.a)).postId;
  }, 120000);
  afterAll(async () => {
    await removeMembers(contractEnv());
    if (admin)
      await contractEnv()
        .db.delete(kaneo.userTable)
        .where(eq(kaneo.userTable.id, admin));
    await stopContract();
  });

  it("a member deletes their own comment", async () => {
    const id = await comment(member);
    const res = await call(
      app,
      contractEnv(),
      member,
      "DELETE",
      `/comments/${id}`,
    );
    expect(res.status).toBe(200);
    expect(await commentDeleted(id)).toBe(true);
  });

  it("a member gets 403 on another person's comment, and the comment stays", async () => {
    const id = await comment(contractEnv().owner);
    const res = await call(
      app,
      contractEnv(),
      member,
      "DELETE",
      `/comments/${id}`,
    );
    expect(res.status).toBe(403);
    expect(await commentDeleted(id)).toBe(false);
  });

  it("an API key without delete gets 403 on another person's comment, though the role holds delete", async () => {
    const { owner } = contractEnv();
    const id = await comment(member);
    expect((await withKey(owner, `/comments/${id}`, noDelete)).status).toBe(
      403,
    );
    expect(await commentDeleted(id)).toBe(false);
    // The same key deletes the owner's own comment; the owner's role alone deletes the member's.
    const own = await comment(owner);
    expect((await withKey(owner, `/comments/${own}`, noDelete)).status).toBe(
      200,
    );
    expect(
      (await call(app, contractEnv(), owner, "DELETE", `/comments/${id}`))
        .status,
    ).toBe(200);
    expect(await commentDeleted(id)).toBe(true);
  });

  it("a member deletes their own saved view and gets 403 on another teammate's shared view", async () => {
    const { owner } = contractEnv();
    const own = await view(member);
    expect(
      (await call(app, contractEnv(), member, "DELETE", `/post-views/${own}`))
        .status,
    ).toBe(200);
    expect(await viewDeleted(own)).toBe(true);
    const shared = await view(owner);
    expect(
      (
        await call(
          app,
          contractEnv(),
          member,
          "DELETE",
          `/post-views/${shared}`,
        )
      ).status,
    ).toBe(403);
    const members = await view(member);
    expect(
      (await withKey(owner, `/post-views/${members}`, noDelete)).status,
    ).toBe(403);
    expect(await viewDeleted(shared)).toBe(false);
    expect(await viewDeleted(members)).toBe(false);
    // A role with the delete action removes another teammate's shared view.
    expect(
      (
        await call(
          app,
          contractEnv(),
          owner,
          "DELETE",
          `/post-views/${members}`,
        )
      ).status,
    ).toBe(200);
    expect(await viewDeleted(members)).toBe(true);
  });

  it("an instance administrator who is not a member deletes another person's comment and view", async () => {
    const env = contractEnv();
    admin = env.id("instance_admin");
    await env.db.insert(kaneo.userTable).values({
      id: admin,
      name: admin,
      email: `${admin}@example.test`,
      role: "admin",
    });
    const id = await comment(member);
    const shared = await view(member);
    expect(
      (await call(app, env, admin, "DELETE", `/comments/${id}`)).status,
    ).toBe(200);
    expect(
      (await call(app, env, admin, "DELETE", `/post-views/${shared}`)).status,
    ).toBe(200);
    expect([await commentDeleted(id), await viewDeleted(shared)]).toEqual([
      true,
      true,
    ]);
  });

  it("restoring a comment stays a moderation action, also for the author", async () => {
    // The source restores with COMMENT_MODERATE, so restore keeps the delete action.
    const id = await comment(member);
    const env = contractEnv();
    expect(
      (await call(app, env, member, "DELETE", `/comments/${id}`)).status,
    ).toBe(200);
    expect(
      (await call(app, env, member, "POST", `/comments/${id}/restore`)).status,
    ).toBe(403);
    expect(await commentDeleted(id)).toBe(true);
  });
});
