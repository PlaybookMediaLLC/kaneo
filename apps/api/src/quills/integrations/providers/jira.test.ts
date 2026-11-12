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
import { JIRA_CLOUD_ID } from "./jira.fixture";

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

const api = `/api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}/rest/api/3`;
const tokenPath = "/auth.atlassian.com/oauth/token";
const projects = `${api}/project/search?maxResults=100`;
type IntegrationId = typeof integrations.$inferSelect.id;

describe.skipIf(!url)("Jira provider with the local provider server", () => {
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
      `/quills-public/signed/oauth/jira/callback?state=${encodeURIComponent(state)}&code=contract-code`,
      as(env().owner),
    );
  const stored = (id: IntegrationId) =>
    env().scoped(env().a, async (db) => {
      const [row] = await db
        .select({ config: integrations.config, secrets: integrations.secrets })
        .from(integrations)
        .where(eq(integrations.id, id));
      return {
        config: row!.config,
        secrets: JSON.parse(decryptSecret(row!.secrets)!),
      };
    });
  const connected = (config: Record<string, unknown>) =>
    oauthConnection(env(), env().a, { type: "jira", config });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());
  afterEach(() => {
    providerOverrides.clear();
    providerCalls.length = 0;
  });

  it("connects through OAuth and stores the cloud ID, with sealed tokens", async () => {
    await platformCredentials(env(), env().a, "jira");
    const res = await app.request(
      `/quills/${env().a}/oauth/jira/connect`,
      as(env().owner),
    );
    expect(res.status).toBe(200);
    const authorize = new URL(
      ((await res.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://auth.atlassian.com/authorize",
    );
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      audience: "api.atlassian.com",
      client_id: "client-jira",
      scope: "read:jira-work write:jira-work offline_access",
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
        integrationType: "jira",
        workspaceName: "Contract site",
        account: "https://contract.atlassian.net",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/jira_contract|cloudId/);
    const exchange = providerCalls.find((call) => call.path === tokenPath)!;
    expect(JSON.parse(exchange.body)).toEqual({
      grant_type: "authorization_code",
      client_id: "client-jira",
      client_secret: APP_SECRET,
      code: "contract-code",
      redirect_uri: expect.stringMatching(/\/oauth\/jira\/callback$/),
    });
    expect(
      providerCalls.find((call) => call.path.endsWith("/accessible-resources"))!
        .authorization,
    ).toBe("Bearer jira_contract_token");
    const row = await stored(body.integration.id);
    // The token answer names no scope: the requested scopes were granted (RFC 6749, 5.1).
    expect(row.config).toMatchObject({
      cloudId: JIRA_CLOUD_ID,
      scopes: "read:jira-work write:jira-work offline_access",
    });
    expect(row.secrets).toMatchObject({
      accessToken: "jira_contract_token",
      refreshToken: "jira_contract_refresh",
    });
    expect(Date.parse(row.secrets.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("lists projects and issue types, and refuses a project that it does not list", async () => {
    const id = await connected({ cloudId: JIRA_CLOUD_ID });
    for (const query of ["", "?kind=project"]) {
      const res = await destinations(id, query);
      expect(res.status, query).toBe(200);
      // A project ID that is not numeric is dropped.
      expect(await res.json()).toEqual({
        destinations: [{ id: "10000", name: "App" }],
      });
    }
    providerCalls.length = 0;
    const types = await destinations(id, "?kind=issue-type&parent=10000");
    expect(types.status).toBe(200);
    expect(await types.json()).toEqual({
      destinations: [
        { id: "10001", name: "Bug" },
        { id: "10002", name: "Task" },
      ],
    });
    expect(providerCalls.map((call) => call.path)).toEqual([
      projects,
      `${api}/issuetype/project?projectId=10000`,
    ]);
    expect(providerCalls[1]!.authorization).toBe(
      `Bearer gho_seeded_${env().a}`,
    );

    providerCalls.length = 0;
    const foreign = await destinations(id, "?kind=issue-type&parent=10099");
    expect(foreign.status).toBe(404);
    expect(providerCalls.map((call) => call.path)).toEqual([projects]);
    for (const query of ["?kind=issue-type", "?kind=project&parent=10000"])
      expect((await destinations(id, query)).status, query).toBe(400);
  });

  it("refuses a stored cloud ID that is not a UUID before any call", async () => {
    for (const cloudId of ["evil.example.com/x", `${JIRA_CLOUD_ID}/../x`]) {
      const id = await connected({ cloudId });
      expect((await destinations(id)).status, cloudId).toBe(409);
    }
    expect(providerCalls).toEqual([]);
  });

  it("refreshes a due token before the call and stores the new tokens", async () => {
    await platformCredentials(env(), env().a, "jira");
    const id = await connected({ cloudId: JIRA_CLOUD_ID });
    const due = (refreshToken: string) =>
      env().scoped(env().a, (db) =>
        db
          .update(integrations)
          .set({
            secrets: encryptSecret(
              JSON.stringify({
                accessToken: "jira_expired",
                refreshToken,
                expiresAt: new Date(Date.now() - 1000).toISOString(),
              }),
            )!,
          })
          .where(eq(integrations.id, id)),
      );
    await due("jira_old_refresh");
    const res = await destinations(id);
    expect(res.status).toBe(200);
    const refresh = providerCalls.find((call) => call.path === tokenPath)!;
    expect(JSON.parse(refresh.body)).toEqual({
      grant_type: "refresh_token",
      client_id: "client-jira",
      client_secret: APP_SECRET,
      refresh_token: "jira_old_refresh",
    });
    expect(
      providerCalls.find((call) => call.path === projects)!.authorization,
    ).toBe("Bearer jira_contract_token");
    const refreshed = (await stored(id)).secrets;
    expect(refreshed).toMatchObject({
      accessToken: "jira_contract_token",
      refreshToken: "jira_contract_refresh",
    });
    expect(Date.parse(refreshed.expiresAt)).toBeGreaterThan(Date.now());

    // A rejected refresh token asks for a reconnect, with a fixed message.
    for (const status of [400, 403]) {
      await due("jira_revoked");
      providerOverrides.set(`POST ${tokenPath}`, {
        status,
        body: { error: "invalid_grant", error_description: "provider detail" },
      });
      const rejected = await destinations(id);
      expect(rejected.status, String(status)).toBe(409);
      const text = await rejected.text();
      expect(text).toContain("Reconnect");
      expect(text).not.toContain("provider detail");
    }
  });

  it("answers a fixed error for a malformed provider answer", async () => {
    await platformCredentials(env(), env().a, "jira");
    await env().scoped(env().a, (db) =>
      db.delete(integrations).where(eq(integrations.integrationType, "jira")),
    );
    for (const id of ["../evil", `${JIRA_CLOUD_ID}/../x`]) {
      providerOverrides.set(
        "GET /api.atlassian.com/oauth/token/accessible-resources",
        { status: 200, body: [{ id, name: "provider detail" }] },
      );
      const state = mintOAuthState({
        workspaceId: env().a,
        userId: env().owner,
        type: "jira",
      });
      const res = await callback(state);
      expect(res.status, id).toBe(400);
      expect(await res.json()).toMatchObject({
        message: "The provider rejected the request.",
      });
    }
    const rows = await env().scoped(env().a, (db) =>
      db
        .select({ id: integrations.id })
        .from(integrations)
        .where(eq(integrations.integrationType, "jira")),
    );
    expect(rows).toEqual([]);

    const id = await connected({ cloudId: JIRA_CLOUD_ID });
    providerOverrides.set(`GET ${api}/project/search`, {
      status: 200,
      body: { values: "provider detail" },
    });
    const list = await destinations(id);
    expect(list.status).toBe(502);
    expect(await list.json()).toMatchObject({
      message: "The provider could not be reached. Try again.",
    });
  });
});
