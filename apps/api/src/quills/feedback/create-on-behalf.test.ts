import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { posts, postVotes } from "../../database/quills/schema/posts";
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

/** A person of a workspace, as the portal or a signal creates one. */
const person = (workspaceId: string, type: "user" | "service" = "user") =>
  world.scoped(
    workspaceId,
    workspaceId === world.b ? world.users.outsider : world.users.owner,
    async (db) => {
      const [row] = await db
        .insert(principal)
        .values({
          type,
          role: "user",
          displayName: "Grace",
          createdAt: new Date(),
        })
        .returning({ id: principal.id });
      return row!.id;
    },
  );
const create = (user: string, authorPrincipalId?: string) =>
  world.request(user, "POST", "/posts", {
    boardId,
    title: "On behalf",
    ...(authorPrincipalId && { authorPrincipalId }),
  });
const postCount = () =>
  world.scoped(world.a, world.users.owner, async (db) =>
    db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.boardId, boardId))
      .then((rows) => rows.length),
  );

describe.skipIf(!url)("Create a post on behalf of a person", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "behalf");
    boardId = await world.scoped(world.a, world.users.owner, async (db) => {
      const [board] = await db
        .insert(boards)
        .values({ name: "Behalf", slug: `behalf-${Date.now()}` })
        .returning({ id: boards.id });
      return board!.id;
    });
  }, 120000);
  afterAll(() => world?.stop());

  it("makes the person the author, first voter and subscriber, tracked by the teammate", async () => {
    const customer = await person(world.a);
    const res = await create(world.users.owner, customer);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ principalId: customer, voteCount: 1 });
    const stored = await world.scoped(
      world.a,
      world.users.owner,
      async (db, actor) => {
        const [post] = await db
          .select({ tracked: posts.trackedByPrincipalId })
          .from(posts)
          .where(eq(posts.id, res.body.id));
        const votes = await db
          .select({ principalId: postVotes.principalId })
          .from(postVotes)
          .where(eq(postVotes.postId, res.body.id));
        const subscribers = await db
          .select({ principalId: postSubscriptions.principalId })
          .from(postSubscriptions)
          .where(
            and(
              eq(postSubscriptions.postId, res.body.id),
              eq(postSubscriptions.reason, "author"),
            ),
          );
        return {
          tracked: post!.tracked,
          actor: actor.principalId,
          votes,
          subscribers,
        };
      },
    );
    expect(stored.tracked).toBe(stored.actor);
    expect(stored.votes).toEqual([{ principalId: customer }]);
    expect(stored.subscribers).toEqual([{ principalId: customer }]);
  });

  it("keeps the caller as the author without the field or with the caller's own ID", async () => {
    const own = await create(world.users.owner);
    expect(own.status).toBe(200);
    const again = await create(world.users.owner, own.body.principalId);
    expect(again.status).toBe(200);
    expect(again.body.principalId).toBe(own.body.principalId);
  });

  it("refuses a person of another workspace or a service principal and writes nothing", async () => {
    const foreign = await person(world.b);
    const service = await person(world.a, "service");
    const before = await postCount();
    expect((await create(world.users.owner, foreign)).status).toBe(404);
    expect((await create(world.users.owner, service)).status).toBe(404);
    expect(await postCount()).toBe(before);
  });

  it("needs the update action to post on behalf of a person, but not for an own post", async () => {
    const customer = await person(world.a);
    const [member] = await world.db
      .select({ role: kaneo.workspaceUserTable.role })
      .from(kaneo.workspaceUserTable)
      .where(
        and(
          eq(kaneo.workspaceUserTable.workspaceId, world.a),
          eq(kaneo.workspaceUserTable.userId, world.users.member),
        ),
      );
    const role = and(
      eq(kaneo.workspaceRoleTable.workspaceId, world.a),
      eq(kaneo.workspaceRoleTable.role, member!.role),
    );
    const permission = (quills: string[]) =>
      world.db
        .update(kaneo.workspaceRoleTable)
        .set({
          permission: JSON.stringify({
            workspace: ["read"],
            project: ["read"],
            quills,
          }),
        })
        .where(role);
    await permission(["read", "create"]);
    try {
      const before = await postCount();
      expect((await create(world.users.member, customer)).status).toBe(403);
      expect(await postCount()).toBe(before);
      expect((await create(world.users.member)).status).toBe(200);
    } finally {
      await permission([
        "read",
        "create",
        "update",
        "delete",
        "manage_settings",
      ]);
    }
  });
});
