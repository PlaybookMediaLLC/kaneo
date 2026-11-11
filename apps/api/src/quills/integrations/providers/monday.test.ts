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
import "./monday.fixture";

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

describe.skipIf(!url)("Monday.com provider with PostgreSQL", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = (userId: string) => ({ headers: { "x-test-user": userId } });
  const callback = (env: ReturnType<typeof contractEnv>) =>
    app.request(
      `/quills-public/signed/oauth/monday/callback?code=c&state=${encodeURIComponent(
        mintOAuthState({
          workspaceId: env.a,
          userId: env.owner,
          type: "monday",
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
        .where(eq(integrations.integrationType, "monday")),
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
    await platformCredentials(contractEnv(), contractEnv().a, "monday");
  }, 120000);
  afterAll(() => stopContract());

  it("connects through the OAuth redirect and keeps the token sealed", async () => {
    const env = contractEnv();
    const start = await app.request(
      `/quills/${env.a}/oauth/monday/connect`,
      as(env.owner),
    );
    expect(start.status).toBe(200);
    const authorize = new URL(
      ((await start.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://auth.monday.com/oauth2/authorize",
    );
    expect(authorize.searchParams.get("client_id")).toBe("client-monday");

    const done = await callback(env);
    expect(done.status).toBe(200);
    const text = await done.text();
    expect(JSON.parse(text)).toMatchObject({
      status: "connected",
      integration: {
        integrationType: "monday",
        workspaceName: "Contract account",
        account: "Contract",
      },
    });
    expect(text).not.toContain("monday-access");
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ secrets: integrations.secrets })
        .from(integrations)
        .where(eq(integrations.integrationType, "monday")),
    );
    expect(JSON.parse(decryptSecret(row!.secrets)!)).toEqual({
      accessToken: "monday-access",
    });
  });

  it("lists boards, at most 200, with valid IDs only", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    const listed = await destinations(env);
    expect(listed.status).toBe(200);
    expect(listed.body.destinations).toHaveLength(200);
    expect(listed.body.destinations[0]).toEqual({
      id: "4000",
      name: "Board 0",
    });
    const call = providerCalls
      .filter((entry) => entry.path === "/api.monday.com/v2")
      .pop();
    expect(JSON.parse(call!.body).query).toContain("boards(limit: 100");
    expect(call!.authorization).toBe("monday-access");
    expect((await destinations(env, "?kind=board")).status).toBe(400);
  });

  it("answers fixed errors for malformed provider answers", async () => {
    const env = contractEnv();
    providerOverrides.set("POST /auth.monday.com/oauth2/token", {
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
    // A failed GraphQL query: 200, `errors` and no `data`.
    providerOverrides.set("POST /api.monday.com/v2", {
      status: 200,
      body: { errors: [{ message: "provider text" }] },
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
