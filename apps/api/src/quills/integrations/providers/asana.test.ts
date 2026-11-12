import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { integrations } from "../../../database/quills/schema/integrations";
import * as kaneo from "../../../database/schema";
import {
  decryptSecret,
  encryptSecret,
} from "../../../notification-preferences/secrets";
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
import "./asana.fixture";

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
/** The latest request to the local provider server whose path matches. */
const lastCall = (path: RegExp) =>
  providerCalls.filter((call) => path.test(call.path)).pop();

describe.skipIf(!url)("Asana provider with PostgreSQL", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = (userId: string) => ({ headers: { "x-test-user": userId } });
  const callback = (env: ReturnType<typeof contractEnv>) =>
    app.request(
      `/quills-public/signed/oauth/asana/callback?code=c&state=${encodeURIComponent(
        mintOAuthState({
          workspaceId: env.a,
          userId: env.owner,
          type: "asana",
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
        .where(eq(integrations.integrationType, "asana")),
    );
    const res = await app.request(
      `/quills/${env.a}/integrations/${row!.id}/destinations${query}`,
      as(env.owner),
    );
    return { status: res.status, body: await res.json() };
  };
  const stored = async (env: ReturnType<typeof contractEnv>) => {
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ secrets: integrations.secrets, config: integrations.config })
        .from(integrations)
        .where(eq(integrations.integrationType, "asana")),
    );
    return {
      secrets: JSON.parse(decryptSecret(row!.secrets)!),
      config: row!.config,
    };
  };
  /** Makes the stored access token due, so the next provider call refreshes it first. */
  const expire = async (env: ReturnType<typeof contractEnv>) => {
    const { secrets } = await stored(env);
    await env.scoped(env.a, (db) =>
      db
        .update(integrations)
        .set({
          secrets: encryptSecret(
            JSON.stringify({
              ...secrets,
              expiresAt: new Date(Date.now() - 1000).toISOString(),
            }),
          )!,
        })
        .where(eq(integrations.integrationType, "asana")),
    );
  };
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    await platformCredentials(contractEnv(), contractEnv().a, "asana");
  }, 120000);
  afterAll(() => stopContract());

  it("connects through the OAuth redirect and keeps the tokens sealed", async () => {
    const env = contractEnv();
    const start = await app.request(
      `/quills/${env.a}/oauth/asana/connect`,
      as(env.owner),
    );
    expect(start.status).toBe(200);
    const authorize = new URL(
      ((await start.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://app.asana.com/-/oauth_authorize",
    );
    expect(authorize.searchParams.get("client_id")).toBe("client-asana");

    const done = await callback(env);
    expect(done.status).toBe(200);
    const text = await done.text();
    expect(JSON.parse(text)).toMatchObject({
      status: "connected",
      integration: {
        integrationType: "asana",
        workspaceName: "Contract workspace",
        account: "Contract",
      },
    });
    expect(text).not.toContain("asana-access");
    expect(text).not.toContain("asana-refresh");
    const exchange = lastCall(/^\/app\.asana\.com\/-\/oauth_token$/);
    expect(new URLSearchParams(exchange!.body).get("grant_type")).toBe(
      "authorization_code",
    );
    const { secrets, config } = await stored(env);
    expect(secrets).toMatchObject({
      accessToken: "asana-access",
      refreshToken: "asana-refresh",
    });
    expect(Date.parse(secrets.expiresAt)).toBeGreaterThan(Date.now());
    expect(config).toMatchObject({ workspaceGid: "1200" });
  });

  it("lists the projects of the stored workspace, at most 200, with valid IDs only", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    const listed = await destinations(env);
    expect(listed.status).toBe(200);
    expect(listed.body.destinations).toHaveLength(200);
    expect(listed.body.destinations[0]).toEqual({
      id: "1000",
      name: "Project 0",
    });
    const call = lastCall(/^\/app\.asana\.com\/api\/1\.0\/projects\?/);
    const query = new URL(call!.path, "http://x").searchParams;
    expect(query.get("workspace")).toBe("1200");
    expect(query.get("archived")).toBe("false");
    expect(query.get("limit")).toBe("100");
    expect(call!.authorization).toBe("Bearer asana-access");
    // One kind of destination: a kind is refused.
    expect((await destinations(env, "?kind=project")).status).toBe(400);
  });

  it("refreshes a due token first and stores only the token fields", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    await expire(env);
    providerOverrides.set("POST /app.asana.com/-/oauth_token", {
      status: 200,
      body: { access_token: "asana-refreshed", expires_in: 3600 },
    });
    try {
      expect((await destinations(env)).status).toBe(200);
    } finally {
      providerOverrides.clear();
    }
    const refresh = lastCall(/^\/app\.asana\.com\/-\/oauth_token$/);
    expect(
      Object.fromEntries(new URLSearchParams(refresh!.body)),
    ).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "asana-refresh",
    });
    expect(lastCall(/\/projects\?/)!.authorization).toBe(
      "Bearer asana-refreshed",
    );
    // Asana keeps the refresh token: the stored one stays. The new expiry is stored.
    const { secrets } = await stored(env);
    expect(secrets).toMatchObject({
      accessToken: "asana-refreshed",
      refreshToken: "asana-refresh",
    });
    expect(Date.parse(secrets.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("asks for a reconnect when Asana rejects the refresh token", async () => {
    const env = contractEnv();
    expect((await callback(env)).status).toBe(200);
    await expire(env);
    providerOverrides.set("POST /app.asana.com/-/oauth_token", {
      status: 400,
      body: { error: "invalid_grant", detail: "provider text" },
    });
    try {
      const res = await destinations(env);
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).not.toContain("provider text");
    } finally {
      providerOverrides.clear();
    }
  });

  it("answers fixed errors for malformed provider answers", async () => {
    const env = contractEnv();
    providerOverrides.set("POST /app.asana.com/-/oauth_token", {
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
    // An account without an Asana workspace has no projects to list.
    providerOverrides.set("GET /app.asana.com/api/1.0/users/me", {
      status: 200,
      body: { data: { name: "Contract", workspaces: [] } },
    });
    try {
      expect((await callback(env)).status).toBe(400);
    } finally {
      providerOverrides.clear();
    }
    // An out-of-range expiry is no expiry, not a server error.
    providerOverrides.set("POST /app.asana.com/-/oauth_token", {
      status: 200,
      body: { access_token: "asana-access", expires_in: 1e13 },
    });
    try {
      expect((await callback(env)).status).toBe(200);
      expect((await stored(env)).secrets.expiresAt).toBe("");
    } finally {
      providerOverrides.clear();
    }

    expect((await callback(env)).status).toBe(200);
    providerOverrides.set("GET /app.asana.com/api/1.0/projects", {
      status: 200,
      body: { data: "provider text" },
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
