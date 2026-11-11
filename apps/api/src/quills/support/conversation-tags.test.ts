import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { conversationTags } from "../../database/quills/schema/conversation";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import { call } from "../feedback/taxonomy-harness.fixture";

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
const send = (method: string, path: string, body?: unknown) => {
  const env = contractEnv();
  return call(app, env, env.owner, method, path, body);
};

/** Waits until a write to conversation_tags waits on a lock. */
async function untilBlocked() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%conversation_tags%'",
    );
    if (rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The request never waited on the lock");
}

/**
 * Runs `request` while another transaction holds a live tag named `name`, uncommitted: the route's
 * name check cannot see it, so its write meets the live-name unique index when that transaction commits.
 */
async function racing(name: string, request: () => ReturnType<typeof send>) {
  const env = contractEnv();
  let pending: ReturnType<typeof send> | undefined;
  await env.scoped(env.a, async (db) => {
    await db.insert(conversationTags).values({ name, color: "#000000" });
    pending = request();
    await untilBlocked();
  });
  return pending!;
}

describe.skipIf(!url)("Quills conversation tag names", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("answers 409, not 500, when a concurrent create takes the name in another case", async () => {
    const res = await racing("Race", () =>
      send("POST", "/conversation-tags", { name: "race" }),
    );
    expect(res.status).toBe(409);
    const env = contractEnv();
    const live = await env.scoped(env.a, (db) =>
      db
        .select({ name: conversationTags.name })
        .from(conversationTags)
        .where(eq(conversationTags.name, "race")),
    );
    expect(live).toEqual([]);
  });

  it("answers 409, not 500, when a concurrent create takes the name of a tag being restored", async () => {
    const created = await send("POST", "/conversation-tags", { name: "Old" });
    await send("DELETE", `/conversation-tags/${created.body.id}`);
    const res = await racing("OLD", () =>
      send("POST", `/conversation-tags/${created.body.id}/restore`),
    );
    expect(res.status).toBe(409);
    const env = contractEnv();
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ deletedAt: conversationTags.deletedAt })
        .from(conversationTags)
        .where(eq(conversationTags.name, "Old")),
    );
    expect(row?.deletedAt).not.toBeNull();
  });
});
