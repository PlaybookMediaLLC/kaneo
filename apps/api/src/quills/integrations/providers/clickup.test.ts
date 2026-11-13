import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { integrations } from "../../../database/quills/schema/integrations";
import * as kaneo from "../../../database/schema";
import { decryptSecret } from "../../../notification-preferences/secrets";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import { mintOAuthState } from "../../framework/signed";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import { platformCredentials } from "../oauth-seed.fixture";
import { providerCalls, providerOverrides } from "../provider-edge.fixture";
import "./clickup.fixture";

let pool: Pool;
vi.mock("../../../database/index", () => ({
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
vi.mock("../../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;

describe.skipIf(!url)("ClickUp provider with PostgreSQL", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = (userId: string) => ({ headers: { "x-test-user": userId } });
  const callback = (env: ReturnType<typeof contractEnv>) =>
    app.request(
      `/quills-public/signed/oauth/clickup/callback?code=c&state=${encodeURIComponent(
        mintOAuthState({
          workspaceId: env.a,
          userId: env.owner,
          type: "clickup",
        }),
      )}`,
      as(env.owner),
    );
  const destinations = async (
    env: ReturnType<typeof contractEnv>,
    query = "",
  ) => {
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ id: integrations.id })
        .from(integrations)
        .where(eq(integrations.integrationType, "clickup")),
    );
    const res = await app.request(
      `/quills/${env.a}/integrations/${row!.id}/destinations${query}`,
      as(env.owner),
    );
    return { status: res.status, body: await res.json() };
  };
  const listCalls = () =>
    providerCalls.filter((call) => /\/space\/[^/]+\/list/.test(call.path));
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    await platformCredentials(contractEnv(), contractEnv().a, "clickup");
  }, 120000);
  afterAll(() => stopContract());

  it("connects through the OAuth redirect and keeps the token sealed", async () => {
    const env = contractEnv();
    const start = await app.request(
      `/quills/${env.a}/oauth/clickup/connect`,
      as(env.owner),
    );
    expect(start.status).toBe(200);
    const authorize = new URL(
      ((await start.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://app.clickup.com/api",
    );
    expect(authorize.searchParams.get("client_id")).toBe("client-clickup");

    const done = await callback(env);
    expect(done.status).toBe(200);
    const text = await done.text();
    expect(JSON.parse(text)).toMatchObject({
      status: "connected",
      integration: {
        integrationType: "clickup",
        workspaceName: "Contract team",
      },
    });
    expect(text).not.toContain("clickup-access");
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ secrets: integrations.secrets, config: integrations.config })
        .from(integrations)
        .where(eq(integrations.integrationType, "clickup")),
    );
    expect(JSON.parse(decryptSecret(row!.secrets)!)).toEqual({
      accessToken: "clickup-access",
    });
    expect(row!.config).toMatchObject({ teamId: "900" });
  });

  it("lists the spaces of the stored team by default and as kind space", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    const spaces = [
      { id: "11", name: "Product" },
      { id: "12", name: "Support" },
    ];
    expect(await destinations(env)).toEqual({
      status: 200,
      body: { destinations: spaces },
    });
    expect(await destinations(env, "?kind=space")).toEqual({
      status: 200,
      body: { destinations: spaces },
    });
    const call = providerCalls
      .filter((entry) => entry.path.includes("/team/900/space"))
      .pop();
    expect(call!.authorization).toBe("Bearer clickup-access");
  });

  it("lists the lists of a space of the team, at most 200", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    const listed = await destinations(env, "?kind=list&parent=11");
    expect(listed.status).toBe(200);
    expect(listed.body.destinations).toHaveLength(200);
    expect(listed.body.destinations[0]).toEqual({ id: "2000", name: "List 0" });
    expect(await destinations(env, "?kind=list&parent=12")).toEqual({
      status: 200,
      body: { destinations: [{ id: "3000", name: "Inbox" }] },
    });
  });

  it("refuses a space that the team does not list, before the list call", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    providerCalls.length = 0;
    expect((await destinations(env, "?kind=list&parent=999")).status).toBe(404);
    expect(listCalls()).toEqual([]);
    for (const query of [
      "?kind=list",
      "?kind=space&parent=11",
      "?kind=list&parent=..%2F13",
      "?kind=folder",
    ])
      expect((await destinations(env, query)).status, query).toBe(400);
    expect(listCalls()).toEqual([]);
  });

  it("answers fixed errors for malformed provider answers", async () => {
    const env = contractEnv();
    providerOverrides.set("POST /api.clickup.com/api/v2/oauth/token", {
      status: 200,
      body: { err: "provider text" },
    });
    try {
      const res = await callback(env);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        message: "The provider rejected the request.",
      });
    } finally {
      providerOverrides.clear();
    }
    // An account without a ClickUp team has no spaces to list.
    providerOverrides.set("GET /api.clickup.com/api/v2/team", {
      status: 200,
      body: { teams: [] },
    });
    try {
      expect((await callback(env)).status).toBe(400);
    } finally {
      providerOverrides.clear();
    }

    expect((await callback(env)).status).toBe(200);
    providerOverrides.set("GET /api.clickup.com/api/v2/space/11/list", {
      status: 200,
      body: { lists: "provider text" },
    });
    try {
      const res = await destinations(env, "?kind=list&parent=11");
      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({
        message: "The provider could not be reached. Try again.",
      });
    } finally {
      providerOverrides.clear();
    }
  });
});
