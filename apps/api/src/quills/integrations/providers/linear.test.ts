import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
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
import {
  APP_SECRET,
  oauthConnection,
  platformCredentials,
} from "../oauth-seed.fixture";
import { providerCalls, providerOverrides } from "../provider-edge.fixture";
import "./linear.fixture";

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

const tokenPath = "/api.linear.app/oauth/token";
const graphqlPath = "/api.linear.app/graphql";
const TEAM = "5b1f4c3e-0000-4000-8000-000000000001";
type IntegrationId = typeof integrations.$inferSelect.id;

describe.skipIf(!url)("Linear provider with the local provider server", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = (userId: string) => ({ headers: { "x-test-user": userId } });
  const env = () => contractEnv();
  const destinations = (id: IntegrationId, query = "") =>
    app.request(
      `/quills/${env().a}/integrations/${id}/destinations${query}`,
      as(env().owner),
    );
  const callback = (state: string) =>
    app.request(
      `/quills-public/signed/oauth/linear/callback?state=${encodeURIComponent(state)}&code=contract-code`,
      as(env().owner),
    );
  const secretsOf = (id: IntegrationId) =>
    env().scoped(env().a, async (db) => {
      const [row] = await db
        .select({ secrets: integrations.secrets })
        .from(integrations)
        .where(eq(integrations.id, id));
      return JSON.parse(decryptSecret(row!.secrets)!);
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());
  afterEach(() => {
    providerOverrides.clear();
    providerCalls.length = 0;
  });

  it("connects through OAuth with sealed tokens", async () => {
    await platformCredentials(env(), env().a, "linear");
    const res = await app.request(
      `/quills/${env().a}/oauth/linear/connect`,
      as(env().owner),
    );
    expect(res.status).toBe(200);
    const authorize = new URL(
      ((await res.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://linear.app/oauth/authorize",
    );
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: "client-linear",
      scope: "read",
      response_type: "code",
    });

    const done = await callback(authorize.searchParams.get("state")!);
    expect(done.status).toBe(200);
    const body = (await done.json()) as {
      integration: { id: IntegrationId };
    };
    expect(body).toMatchObject({
      status: "connected",
      integration: {
        integrationType: "linear",
        workspaceName: "Contract",
        account: "contract",
      },
    });
    expect(JSON.stringify(body)).not.toContain("linear_contract");
    const exchange = providerCalls.find((call) => call.path === tokenPath)!;
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({
      client_id: "client-linear",
      client_secret: APP_SECRET,
      grant_type: "authorization_code",
      code: "contract-code",
      redirect_uri: expect.stringMatching(/\/oauth\/linear\/callback$/),
    });
    const organization = providerCalls.find(
      (call) => call.path === graphqlPath,
    )!;
    expect(organization.authorization).toBe("Bearer linear_contract_token");
    expect(JSON.parse(organization.body).query).toContain("organization");
    expect(await secretsOf(body.integration.id)).toMatchObject({
      accessToken: "linear_contract_token",
      refreshToken: "linear_contract_refresh",
    });
    expect(
      Date.parse((await secretsOf(body.integration.id)).expiresAt),
    ).toBeGreaterThan(Date.now());
  });

  it("lists teams and refuses a kind or a parent", async () => {
    const id = await oauthConnection(env(), env().a, { type: "linear" });
    const res = await destinations(id);
    expect(res.status).toBe(200);
    // A team ID outside the pattern is dropped.
    expect(await res.json()).toEqual({
      destinations: [{ id: TEAM, name: "Engineering" }],
    });
    const list = providerCalls.find((call) => call.path === graphqlPath)!;
    expect(list.authorization).toBe(`Bearer gho_seeded_${env().a}`);
    expect(JSON.parse(list.body).query).toContain("teams(first: 100)");

    providerCalls.length = 0;
    for (const query of ["?kind=team", `?parent=${TEAM}`])
      expect((await destinations(id, query)).status, query).toBe(400);
    expect(providerCalls).toEqual([]);
  });

  it("refreshes a due token before the call and stores the new tokens", async () => {
    await platformCredentials(env(), env().a, "linear");
    const id = await oauthConnection(env(), env().a, { type: "linear" });
    const due = (refreshToken: string) =>
      env().scoped(env().a, (db) =>
        db
          .update(integrations)
          .set({
            secrets: encryptSecret(
              JSON.stringify({
                accessToken: "linear_expired",
                refreshToken,
                expiresAt: new Date(Date.now() - 1000).toISOString(),
              }),
            )!,
          })
          .where(eq(integrations.id, id)),
      );
    await due("linear_old_refresh");
    expect((await destinations(id)).status).toBe(200);
    const refresh = providerCalls.find((call) => call.path === tokenPath)!;
    expect(Object.fromEntries(new URLSearchParams(refresh.body))).toEqual({
      client_id: "client-linear",
      client_secret: APP_SECRET,
      grant_type: "refresh_token",
      refresh_token: "linear_old_refresh",
    });
    expect(
      providerCalls.find((call) => call.path === graphqlPath)!.authorization,
    ).toBe("Bearer linear_contract_token");
    const refreshed = await secretsOf(id);
    expect(refreshed).toMatchObject({
      accessToken: "linear_contract_token",
      refreshToken: "linear_contract_refresh",
    });
    expect(Date.parse(refreshed.expiresAt)).toBeGreaterThan(Date.now());

    // A rejected refresh token asks for a reconnect, with a fixed message.
    await due("linear_revoked");
    providerOverrides.set(`POST ${tokenPath}`, {
      status: 400,
      body: { error: "invalid_grant", error_description: "provider detail" },
    });
    const rejected = await destinations(id);
    expect(rejected.status).toBe(409);
    const text = await rejected.text();
    expect(text).toContain("Reconnect");
    expect(text).not.toContain("provider detail");
  });

  it("answers a fixed error for a malformed provider answer", async () => {
    await platformCredentials(env(), env().a, "linear");
    await env().scoped(env().a, (db) =>
      db.delete(integrations).where(eq(integrations.integrationType, "linear")),
    );
    providerOverrides.set(`POST ${tokenPath}`, {
      status: 200,
      body: { error: "provider detail" },
    });
    const res = await callback(
      mintOAuthState({
        workspaceId: env().a,
        userId: env().owner,
        type: "linear",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: "The provider rejected the request.",
    });
    const rows = await env().scoped(env().a, (db) =>
      db
        .select({ id: integrations.id })
        .from(integrations)
        .where(eq(integrations.integrationType, "linear")),
    );
    expect(rows).toEqual([]);

    const id = await oauthConnection(env(), env().a, { type: "linear" });
    providerOverrides.set(`POST ${graphqlPath}`, {
      status: 200,
      body: { errors: [{ message: "provider detail" }] },
    });
    const list = await destinations(id);
    expect(list.status).toBe(502);
    expect(await list.json()).toMatchObject({
      message: "The provider could not be reached. Try again.",
    });
  });
});
