import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { kvStore } from "../../database/quills/schema/kv";
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
import { enablePortal } from "../portal/customer-seed.fixture";
import { enableMessenger } from "./customer/seed.fixture";

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

async function send(
  method: string,
  path: string,
  options: { user?: string; workspace?: string; body?: unknown } = {},
) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(options.user && { "x-test-user": options.user }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const heartbeat = (workspace: string, user: string) =>
  send("PUT", `/quills/${workspace}/support/presence`, { user });
const availability = (value: "online" | "away") => {
  const env = contractEnv();
  return send("PUT", `/quills/${env.a}/support/availability`, {
    user: env.owner,
    body: { availability: value },
  });
};
const widgetPresence = async () =>
  (await send("GET", `/quills-public/${contractEnv().a}/widget/presence`)).body;
const portalPresence = async () =>
  (await send("GET", `/quills-public/${contractEnv().a}/support/presence`))
    .body;
/** Removes A's heartbeats, so each case starts with no teammate online. */
const clearHeartbeats = () => {
  const env = contractEnv();
  return env.scoped(env.a, (db) =>
    db.delete(kvStore).where(like(kvStore.key, "support:presence:%")),
  );
};

describe.skipIf(!url)("Quills agent presence", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    const env = contractEnv();
    await enableMessenger(env, env.a);
    await enablePortal(env, env.a);
  }, 120000);
  afterAll(() => stopContract());

  it("reports a teammate online after a heartbeat, in the widget and the portal", async () => {
    await clearHeartbeats();
    expect(await widgetPresence()).toMatchObject({ agentsOnline: false });
    expect(await portalPresence()).toMatchObject({ agentsOnline: false });
    const env = contractEnv();
    expect(await heartbeat(env.a, env.owner)).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(await widgetPresence()).toMatchObject({ agentsOnline: true });
    expect(await portalPresence()).toMatchObject({ agentsOnline: true });
  });

  it("keeps one row per teammate and lets it lapse", async () => {
    await clearHeartbeats();
    const env = contractEnv();
    await heartbeat(env.a, env.owner);
    await heartbeat(env.a, env.owner);
    const rows = await env.scoped(env.a, (db) =>
      db
        .select({ key: kvStore.key })
        .from(kvStore)
        .where(like(kvStore.key, "support:presence:%")),
    );
    expect(rows).toHaveLength(1);
    await env.scoped(env.a, (db) =>
      db
        .update(kvStore)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(kvStore.key, rows[0]!.key)),
    );
    expect(await widgetPresence()).toMatchObject({ agentsOnline: false });
    await heartbeat(env.a, env.owner);
    expect(await widgetPresence()).toMatchObject({ agentsOnline: true });
  });

  it("does not count a teammate who is set to away", async () => {
    await clearHeartbeats();
    const env = contractEnv();
    await heartbeat(env.a, env.owner);
    expect((await availability("away")).status).toBe(200);
    try {
      expect(await widgetPresence()).toMatchObject({ agentsOnline: false });
    } finally {
      await availability("online");
    }
    expect(await widgetPresence()).toMatchObject({ agentsOnline: true });
  });

  it("never counts a heartbeat of workspace B in workspace A", async () => {
    await clearHeartbeats();
    const env = contractEnv();
    const ownerOfB = await env.scoped(
      env.b,
      async (_db, actor) => actor.userId,
    );
    expect((await heartbeat(env.b, ownerOfB)).status).toBe(200);
    expect(await widgetPresence()).toMatchObject({ agentsOnline: false });
    const inB = await env.scoped(env.b, (db) =>
      db
        .select({ key: kvStore.key })
        .from(kvStore)
        .where(like(kvStore.key, "support:presence:%")),
    );
    expect(inB).toHaveLength(1);
  });
});
