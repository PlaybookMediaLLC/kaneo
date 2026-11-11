import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { integrations } from "../../database/quills/schema/integrations";
import * as kaneo from "../../database/schema";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { mintOAuthState } from "../framework/signed";
import quillsRouter from "../index";
import publicRouter from "../public";
import type { OAuthProvider } from "./oauth-providers";
import { oauthConnection, platformCredentials } from "./oauth-seed.fixture";

// The provider seams of RFC 0001 with two stub providers that exist only in this file: connect
// fields (stubdesk) and destination kinds with a parent (stubboard). No stub calls a network.

const seen = vi.hoisted(() => ({
  exchanged: [] as Record<string, string>[],
  listed: [] as { kind?: string; parent?: string }[],
}));
vi.mock("./providers/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("./providers/index")>();
  const stub = {
    category: "issue_tracking",
    description: "A test stub.",
    events: [],
    channels: true,
    credentials: ["clientId", "clientSecret"],
    statuses: [],
  };
  const stubdesk = {
    ...stub,
    name: "Stubdesk",
    hosts: /^[a-z0-9-]+\.stubdesk\.test$/,
    connectFields: { subdomain: /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?/ },
    authorizeUrl: (_creds, _redirectUri, state, fields) =>
      `https://${fields.subdomain}.stubdesk.test/oauth?state=${encodeURIComponent(state)}`,
    exchange: async (_code, _redirectUri, _creds, fields) => {
      seen.exchanged.push(fields);
      return {
        secrets: { accessToken: "stubdesk-token" },
        workspaceName: "Stubdesk",
        account: null,
        config: { subdomain: fields.subdomain ?? "" },
      };
    },
    destinations: async () => [],
  } satisfies OAuthProvider;
  const stubboard = {
    ...stub,
    name: "Stubboard",
    hosts: /^api\.stubboard\.test$/,
    authorizeUrl: () => "https://api.stubboard.test/authorize",
    exchange: async () => {
      throw new Error("not used");
    },
    destinationKinds: { board: {}, list: { parent: "board" } },
    destinations: async (_secrets, _config, _creds, scope) => {
      seen.listed.push(scope);
      return scope.kind === "list"
        ? [{ id: `${scope.parent}-list`, name: "List" }]
        : [{ id: "b1", name: "Board" }];
    },
  } satisfies OAuthProvider;
  const oauthProviders = { ...real.oauthProviders, stubdesk, stubboard };
  const oauthProvider = (type: string) =>
    (oauthProviders as Record<string, OAuthProvider>)[type];
  return {
    ...real,
    oauthProviders,
    oauthProvider,
    oauthTypes: [...real.oauthTypes, "stubdesk", "stubboard"],
    oauthApp: oauthProvider,
  };
});

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

describe.skipIf(!url)("provider seams with PostgreSQL", () => {
  const app = contractApp(quillsRouter, publicRouter);
  const as = (userId: string) => ({ headers: { "x-test-user": userId } });
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("checks connect fields at the route and carries them, signed, to exchange", async () => {
    const env = contractEnv();
    await platformCredentials(env, env.a, "stubdesk");
    const connect = (query: string) =>
      app.request(
        `/quills/${env.a}/oauth/stubdesk/connect${query}`,
        as(env.owner),
      );
    for (const query of [
      "",
      "?subdomain=",
      "?subdomain=evil.example.com",
      "?subdomain=acme%2F..",
      "?subdomain=acme%23x",
      `?subdomain=${"a".repeat(300)}`,
    ])
      expect((await connect(query)).status, query).toBe(400);

    const res = await connect("?subdomain=acme");
    expect(res.status).toBe(200);
    const authorize = new URL(
      ((await res.json()) as { authorizeUrl: string }).authorizeUrl,
    );
    expect(authorize.hostname).toBe("acme.stubdesk.test");
    const state = authorize.searchParams.get("state")!;
    const [payload, signature] = state.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(claims.f).toEqual({ subdomain: "acme" });

    const callback = (value: string) =>
      app.request(
        `/quills-public/signed/oauth/stubdesk/callback?state=${encodeURIComponent(value)}&code=c`,
        as(env.owner),
      );
    // The signature covers the fields: an altered field makes the state invalid.
    const altered = `${Buffer.from(JSON.stringify({ ...claims, f: { subdomain: "evil" } })).toString("base64url")}.${signature}`;
    expect((await callback(altered)).status).toBe(401);
    expect(seen.exchanged).toEqual([]);

    const done = await callback(state);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ status: "connected" });
    expect(seen.exchanged).toEqual([{ subdomain: "acme" }]);
    const [row] = await env.scoped(env.a, (db) =>
      db
        .select({ config: integrations.config })
        .from(integrations)
        .where(eq(integrations.integrationType, "stubdesk")),
    );
    expect(row!.config).toMatchObject({ subdomain: "acme" });
  });

  it("refuses a state with connect fields that the provider does not declare", async () => {
    const env = contractEnv();
    const state = mintOAuthState({
      workspaceId: env.a,
      userId: env.owner,
      type: "github",
      fields: { subdomain: "acme" },
    });
    const res = await app.request(
      `/quills-public/signed/oauth/github/callback?state=${encodeURIComponent(state)}&code=c`,
      as(env.owner),
    );
    expect(res.status).toBe(400);
  });

  it("lists a child kind only under a parent that the integration lists", async () => {
    const env = contractEnv();
    const id = await oauthConnection(env, env.a, { type: "stubboard" });
    const list = async (query: string) => {
      const res = await app.request(
        `/quills/${env.a}/integrations/${id}/destinations${query}`,
        as(env.owner),
      );
      return {
        status: res.status,
        body: (await res.json()) as { destinations?: unknown },
      };
    };
    expect(await list("")).toMatchObject({
      status: 200,
      body: { destinations: [{ id: "b1", name: "Board" }] },
    });
    seen.listed.length = 0;
    expect(await list("?kind=list&parent=b1")).toMatchObject({
      status: 200,
      body: { destinations: [{ id: "b1-list", name: "List" }] },
    });
    // The route lists the parent kind first, then the child under it.
    expect(seen.listed).toEqual([
      { kind: "board" },
      { kind: "list", parent: "b1" },
    ]);
    seen.listed.length = 0;
    expect((await list("?kind=list&parent=b2")).status).toBe(404);
    expect(seen.listed).toEqual([{ kind: "board" }]);
    seen.listed.length = 0;
    for (const query of [
      "?kind=list",
      "?kind=board&parent=b1",
      "?parent=b1",
      "?kind=card",
      "?kind=constructor",
      "?kind=list&parent=b1%2F..",
      "?kind=list&parent=b1%0A",
    ])
      expect((await list(query)).status, query).toBe(400);
    expect(seen.listed).toEqual([]);

    // A provider without kinds keeps its single list and refuses a kind.
    const github = await oauthConnection(env, env.a);
    const res = await app.request(
      `/quills/${env.a}/integrations/${github}/destinations?kind=list`,
      as(env.owner),
    );
    expect(res.status).toBe(400);
  });
});
