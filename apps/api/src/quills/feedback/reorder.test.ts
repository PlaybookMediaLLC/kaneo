import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { asc, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { roadmaps } from "../../database/quills/schema/boards";
import { changelogCategories } from "../../database/quills/schema/changelog-categories";
import { postStatuses } from "../../database/quills/schema/statuses";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
  type ContractEnv,
} from "../framework/contract";
import { call } from "./harness.fixture";
import { statusIn } from "./seeds.fixture";

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

type Case = {
  path: string;
  field: string;
  /** A new row in the workspace. */
  add: (env: ContractEnv, workspaceId: string) => Promise<string>;
  /** Live rows of A with their positions. */
  positions: (env: ContractEnv) => Promise<{ id: string; position: number }[]>;
};
const cases: Record<string, Case> = {
  statuses: {
    path: "/statuses/order",
    field: "statusIds",
    add: statusIn,
    positions: (env) =>
      env.scoped(env.a, (db) =>
        db
          .select({ id: postStatuses.id, position: postStatuses.position })
          .from(postStatuses)
          .where(isNull(postStatuses.deletedAt))
          .orderBy(asc(postStatuses.createdAt), asc(postStatuses.id)),
      ),
  },
  roadmaps: {
    path: "/roadmaps/order",
    field: "roadmapIds",
    add: async (env, workspaceId) =>
      (
        await env.scoped(workspaceId, (db) =>
          db
            .insert(roadmaps)
            .values({ name: "Order", slug: env.id("roadmap") })
            .returning({ id: roadmaps.id }),
        )
      )[0]!.id,
    positions: (env) =>
      env.scoped(env.a, (db) =>
        db
          .select({ id: roadmaps.id, position: roadmaps.position })
          .from(roadmaps)
          .where(isNull(roadmaps.deletedAt))
          .orderBy(asc(roadmaps.createdAt), asc(roadmaps.id)),
      ),
  },
  "changelog categories": {
    path: "/changelog/categories/order",
    field: "categoryIds",
    add: async (env, workspaceId) =>
      (
        await env.scoped(workspaceId, (db) =>
          db
            .insert(changelogCategories)
            .values({ name: env.id("category"), color: "#6b7280" })
            .returning({ id: changelogCategories.id }),
        )
      )[0]!.id,
    positions: (env) =>
      env.scoped(env.a, (db) =>
        db
          .select({
            id: changelogCategories.id,
            position: changelogCategories.position,
          })
          .from(changelogCategories)
          .orderBy(
            asc(changelogCategories.createdAt),
            asc(changelogCategories.id),
          ),
      ),
  },
};

describe.skipIf(!url)("Quills reorders are all-or-nothing", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it.each(Object.entries(cases))("%s", async (_name, c) => {
    const env = contractEnv();
    await c.add(env, env.a);
    await c.add(env, env.a);
    const foreign = await c.add(env, env.b);
    const send = (ids: string[]) =>
      call(app, env, env.owner, "PUT", c.path, { [c.field]: ids });
    const order = (await c.positions(env)).map((row) => row.id).reverse();

    expect(await send(order)).toEqual({
      status: 200,
      body: { [c.field]: order },
    });
    const stored = await c.positions(env);
    for (const row of stored) expect(row.position).toBe(order.indexOf(row.id));

    // A foreign, missing or repeated ID changes nothing.
    const swapped = [foreign, ...order.slice(1)];
    expect((await send(swapped)).status).toBe(404);
    expect((await send(order.slice(1))).status).toBe(409);
    expect((await send([...order.slice(1), order[1]!])).status).toBe(400);
    expect((await send([])).status).toBe(400);
    expect(await c.positions(env)).toEqual(stored);

    // A row added after the client read the list makes the list stale.
    await c.add(env, env.a);
    expect((await send([...order].reverse())).status).toBe(409);
    expect((await c.positions(env)).slice(0, stored.length)).toEqual(stored);
  });
});
