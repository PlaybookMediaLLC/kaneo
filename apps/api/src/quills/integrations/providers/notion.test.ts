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
import { APP_SECRET, platformCredentials } from "../oauth-seed.fixture";
import { providerCalls, providerOverrides } from "../provider-edge.fixture";
import "./notion.fixture";

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

describe.skipIf(!url)("Notion provider with PostgreSQL", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = (userId: string) => ({ headers: { "x-test-user": userId } });
  const callback = (env: ReturnType<typeof contractEnv>) =>
    app.request(
      `/quills-public/signed/oauth/notion/callback?code=c&state=${encodeURIComponent(
        mintOAuthState({
          workspaceId: env.a,
          userId: env.owner,
          type: "notion",
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
        .where(eq(integrations.integrationType, "notion")),
    );
    const res = await app.request(
      `/quills/${env.a}/integrations/${row!.id}/destinations${query}`,
      as(env.owner),
    );
    return { status: res.status, body: await res.json() };
  };
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    await platformCredentials(contractEnv(), contractEnv().a, "notion");
  }, 120000);
  afterAll(() => stopContract());

  it("connects with HTTP Basic app credentials and keeps the token sealed", async () => {
    const env = contractEnv();
    const start = await app.request(
      `/quills/${env.a}/oauth/notion/connect`,
      as(env.owner),
    );
    expect(start.status).toBe(200);
    const authorize = new URL(
      ((await start.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://api.notion.com/v1/oauth/authorize",
    );
    expect(authorize.searchParams.get("owner")).toBe("user");

    const done = await callback(env);
    expect(done.status).toBe(200);
    const text = await done.text();
    expect(JSON.parse(text)).toMatchObject({
      status: "connected",
      integration: {
        integrationType: "notion",
        workspaceName: "Contract workspace",
        account: "Contract",
      },
    });
    expect(text).not.toContain("notion-access");
    const exchange = providerCalls
      .filter((call) => call.path === "/api.notion.com/v1/oauth/token")
      .pop();
    expect(exchange!.authorization).toBe(
      `Basic ${Buffer.from(`client-notion:${APP_SECRET}`).toString("base64")}`,
    );
    // The client secret travels only in the header.
    expect(exchange!.body).not.toContain(APP_SECRET);
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ secrets: integrations.secrets })
        .from(integrations)
        .where(eq(integrations.integrationType, "notion")),
    );
    expect(JSON.parse(decryptSecret(row!.secrets)!)).toEqual({
      accessToken: "notion-access",
    });
  });

  it("lists databases, at most 200, with UUIDs only and their plain titles", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    const listed = await destinations(env);
    expect(listed.status).toBe(200);
    expect(listed.body.destinations).toHaveLength(200);
    expect(listed.body.destinations.slice(0, 2)).toEqual([
      { id: "00000000-0000-4000-8000-000000000000", name: "Roadmap" },
      { id: "00000000-0000-4000-8000-000000000001", name: "Untitled" },
    ]);
    const call = providerCalls
      .filter((entry) => entry.path === "/api.notion.com/v1/search")
      .pop();
    expect(JSON.parse(call!.body)).toMatchObject({
      filter: { property: "object", value: "database" },
      page_size: 100,
    });
    expect(call!.authorization).toBe("Bearer notion-access");
    expect((await destinations(env, "?kind=database")).status).toBe(400);
  });

  it("answers fixed errors for malformed provider answers", async () => {
    const env = contractEnv();
    providerOverrides.set("POST /api.notion.com/v1/oauth/token", {
      status: 200,
      body: { error: "provider text" },
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

    expect((await callback(env)).status).toBe(200);
    providerOverrides.set("POST /api.notion.com/v1/search", {
      status: 200,
      body: { object: "error", message: "provider text" },
    });
    try {
      const res = await destinations(env);
      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({
        message: "The provider could not be reached. Try again.",
      });
    } finally {
      providerOverrides.clear();
    }
  });
});
