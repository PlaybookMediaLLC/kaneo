import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { integrationEventMappings } from "../../database/quills/schema/integrations";
import * as kaneo from "../../database/schema";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import quillsRouter from "../index";
import { oauthConnection } from "./oauth-seed.fixture";
import { channel } from "./seed.fixture";

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

// The channel route's target checks: one bounded schema for every provider, then the provider's rule.
describe.skipIf(!url)("notification channel targets", () => {
  const app = contractApp(quillsRouter);
  const env = () => contractEnv();
  const add = (integrationId: string, channel: string) =>
    app.request(`/quills/${env().a}/integrations/${integrationId}/channels`, {
      method: "POST",
      headers: {
        "x-test-user": env().owner,
        "content-type": "application/json",
      },
      body: JSON.stringify({ channel, events: ["post.created"] }),
    });
  const mappings = () =>
    env().scoped(env().a, (db) =>
      db
        .select({ target: integrationEventMappings.targetKey })
        .from(integrationEventMappings),
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("refuses path separators, control characters and oversized values for every provider", async () => {
    const { integrationId } = await channel(env(), env().a);
    const linear = await oauthConnection(env(), env().a, { type: "linear" });
    const before = await mappings();
    for (const id of [integrationId, linear])
      for (const bad of [
        "a/b",
        "a\\b",
        "a?b",
        "a#b",
        "a%2e",
        "a\u0000b",
        "a\u0007b",
        "a\nb",
        "a\u0085b",
        "a".repeat(101),
        "",
      ])
        expect((await add(id, bad)).status, JSON.stringify(bad)).toBe(400);
    expect(await mappings()).toEqual(before);
  });

  it("checks the provider's own rule, and keeps the earlier pattern for Shortcut", async () => {
    const { integrationId } = await channel(env(), env().a);
    expect((await add(integrationId, "group 1")).status).toBe(400);
    expect((await add(integrationId, "group-new")).status).toBe(200);
    const linear = await oauthConnection(env(), env().a, { type: "linear" });
    const refused = await add(linear, "eng");
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("not a valid target");
  });
});
