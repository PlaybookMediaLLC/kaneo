import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { auditLog } from "../../database/quills/schema/audit-log";
import { connectors } from "../../database/quills/schema/connectors";
import type { BaseVariables } from "../../openapi";
import router from "..";
import { openCredentials } from "../framework/integration-config";
import { harness } from "../jobs/handlers/harness.fixture";
import publicRouter from "../public";
import {
  BEARER,
  CODE,
  edge,
  PUBLIC_ORIGIN,
  REFRESH,
} from "./connector-edge.fixture";

// Connector behavior beyond the route contract: the OAuth flow, token refresh, private addresses,
// a URL change, a change during a call and the catalogue bounds. Real PostgreSQL, workspaces A and
// B, and the local MCP and OAuth server of connector-edge.fixture.ts.

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
vi.mock("../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));
// The OAuth callback reads the browser session; here the x-test-user account is signed in.
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: async (headers: Headers) => {
    const id = headers.get("x-test-user");
    return id ? { user: { id }, session: { id: `${id}_session` } } : null;
  },
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("connectors");
const app = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
app.use("/quills/*", async (c, next) => {
  c.set("userId", c.req.header("x-user")!);
  c.set("user", null);
  await next();
});
app.route("/quills", router);
app.route("/quills-public", publicRouter);
app.onError((error, c) =>
  error instanceof HTTPException
    ? c.json({ message: error.message }, error.status)
    : c.json({ message: "Internal error" }, 500),
);
const call = async (path: string, method = "GET", body?: unknown) => {
  const res = await app.request(`/quills/${h.a}${path}`, {
    method,
    headers: {
      "x-user": h.owner,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const add = (name: string, path: string, extra: object = {}) =>
  call("/assistant/connectors", "POST", {
    name,
    url: `${PUBLIC_ORIGIN}${path}`,
    ...extra,
  });
const stored = async (id: string) =>
  (
    await h.system(h.a, (db) =>
      db
        .select({ url: connectors.url, secrets: connectors.secrets })
        .from(connectors)
        .where(eq(connectors.id, id as never)),
    )
  )[0]!;

describe.skipIf(!url)("assistant connectors", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  beforeEach(() => edge.reset());

  it("adds a connector with its tools and keeps the bearer token sealed", async () => {
    const res = await add("Docs bearer", "/bearer/mcp", {
      authMode: "bearer",
      bearerToken: BEARER,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "connected",
      hasSecret: true,
      toolCount: 2,
      tools: [
        { name: "search", group: "read", policy: "always" },
        { name: "create_issue", group: "write", policy: "approval" },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain(BEARER);
    expect((await stored(res.body.id)).secrets).not.toContain(BEARER);
    expect(
      edge.requests.some((r) => r.authorization === `Bearer ${BEARER}`),
    ).toBe(true);
  });

  it("refuses a private address before any request and stores nothing", async () => {
    const res = await call("/assistant/connectors", "POST", {
      name: "Private",
      url: "https://127.0.0.1:9/mcp",
    });
    expect(res).toEqual({
      status: 400,
      body: { message: "That address cannot be reached from this workspace." },
    });
    expect(edge.requests).toEqual([]);
    const rows = await h.system(h.a, (db) =>
      db
        .select({ id: connectors.id })
        .from(connectors)
        .where(eq(connectors.name, "Private")),
    );
    expect(rows).toEqual([]);
  });

  it("refuses a server answer over 1 MB", async () => {
    edge.tools = [
      {
        name: "big",
        inputSchema: { type: "object" },
        description: "x".repeat(1_100_000),
      },
    ];
    const res = await add("Too big", "/open/mcp");
    expect(res.status).toBe(502);
    expect(res.body.message).not.toContain("x".repeat(10));
  });

  it("bounds the stored tool catalogue", async () => {
    edge.tools = [
      { name: "n".repeat(129), inputSchema: { type: "object" } },
      {
        name: "huge",
        inputSchema: { type: "object", description: "s".repeat(20_001) },
      },
      ...Array.from({ length: 150 }, (_, i) => ({
        name: `tool_${i}`,
        inputSchema: { type: "object" },
      })),
    ];
    const res = await add("Many tools", "/open/mcp");
    expect(res.body.toolCount).toBe(100);
    expect(res.body.tools[0].name).toBe("huge");
    const [row] = await h.system(h.a, (db) =>
      db
        .select({ tools: connectors.tools })
        .from(connectors)
        .where(eq(connectors.id, res.body.id)),
    );
    expect(row!.tools[0]).not.toHaveProperty("inputSchema");
    expect(row!.tools.every((tool) => tool.name.length <= 128)).toBe(true);
  });

  it("authorizes an OAuth server once, through the signed callback", async () => {
    // A server that asks for authorization becomes an OAuth connector.
    const created = await add("Docs oauth", "/oauth/mcp");
    expect(created.body).toMatchObject({
      authMode: "oauth",
      status: "error",
      lastError: "Authorization required",
      hasSecret: false,
      toolCount: 0,
    });
    const id = created.body.id as string;
    const started = await call(`/assistant/connectors/${id}/oauth`, "POST");
    expect(started.status).toBe(200);
    const authorize = new URL(started.body.authorizationUrl);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      `${PUBLIC_ORIGIN}/authorize`,
    );
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `http://localhost:1337/api/quills-public/signed/oauth/connectors/${id}/callback`,
    );
    const callback = (user: string) =>
      app.request(
        `/quills-public/signed/oauth/connectors/${id}/callback?${new URLSearchParams(
          { state: authorize.searchParams.get("state")!, code: CODE },
        )}`,
        { headers: { "x-test-user": user } },
      );
    // Another teammate's browser cannot complete it.
    expect((await callback(h.mate)).status).toBe(401);
    const done = await callback(h.owner);
    const body = (await done.json()) as any;
    expect(done.status).toBe(200);
    expect(body).toMatchObject({
      status: "connected",
      connector: { status: "connected", toolCount: 2, hasSecret: true },
    });
    expect(JSON.stringify(body)).not.toMatch(/mcp-contract-access|refresh/);
    // The state works once.
    expect(await (await callback(h.owner)).json()).toEqual({
      status: "already_used",
      connector: null,
    });
    const secrets = openCredentials((await stored(id)).secrets)!;
    expect(secrets.codeVerifier).toBeUndefined();
    expect(JSON.parse(secrets.tokens!).refresh_token).toBe(REFRESH);
    const [audit] = await h.system(h.a, (db) =>
      db
        .select({ actorId: auditLog.actorPrincipalId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.eventType, "assistant_connector.connected"),
            eq(auditLog.targetId, id),
          ),
        ),
    );
    expect(audit?.actorId).toBe(await h.principal(h.a, h.owner));

    // An expired access token: the refresh uses the refresh token and keeps the new access token.
    const before = JSON.parse(secrets.tokens!).access_token;
    edge.access.clear();
    edge.requests = [];
    const refreshed = await call(`/assistant/connectors/${id}/refresh`, "POST");
    expect(refreshed.body).toMatchObject({
      status: "connected",
      lastError: null,
    });
    expect(edge.requests.some((r) => r.path === "/token")).toBe(true);
    const after = JSON.parse(
      openCredentials((await stored(id)).secrets)!.tokens!,
    ).access_token;
    expect(after).not.toBe(before);
    expect(edge.access.has(after)).toBe(true);
  });

  it("stores a refused refresh as an error with a fixed message", async () => {
    const created = await add("Docs refused", "/bearer/mcp", {
      authMode: "bearer",
      bearerToken: BEARER,
    });
    const id = created.body.id as string;
    await call(`/assistant/connectors/${id}`, "PATCH", {
      bearerToken: "wrong-token",
    });
    const res = await call(`/assistant/connectors/${id}/refresh`, "POST");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "error",
      lastError: "Authorization required",
      toolCount: 2,
    });
  });

  it("drops the stored credentials when the URL changes", async () => {
    const created = await add("Docs moved", "/bearer/mcp", {
      authMode: "bearer",
      bearerToken: BEARER,
    });
    const id = created.body.id as string;
    const moved = await call(`/assistant/connectors/${id}`, "PATCH", {
      url: `${PUBLIC_ORIGIN}/open/mcp`,
    });
    expect(moved.body).toMatchObject({
      hasSecret: false,
      status: "error",
      lastError: "The URL changed. Refresh the connector.",
    });
    expect((await stored(id)).secrets).toBeNull();
    // A token sent with the new URL is kept.
    const back = await call(`/assistant/connectors/${id}`, "PATCH", {
      url: `${PUBLIC_ORIGIN}/bearer/mcp`,
      bearerToken: BEARER,
    });
    expect(back.body.hasSecret).toBe(true);
  });

  it("does not store a result for a URL that changed during the refresh", async () => {
    const created = await add("Docs raced", "/bearer/mcp", {
      authMode: "bearer",
      bearerToken: BEARER,
    });
    const id = created.body.id as string;
    edge.requests = [];
    let release!: () => void;
    edge.gate = new Promise((resolve) => (release = resolve));
    const refresh = call(`/assistant/connectors/${id}/refresh`, "POST");
    await vi.waitFor(() =>
      expect(edge.requests.filter((r) => r.method === "POST").length).toBe(3),
    );
    await call(`/assistant/connectors/${id}`, "PATCH", {
      url: `${PUBLIC_ORIGIN}/open/mcp`,
    });
    release();
    expect(await refresh).toEqual({
      status: 409,
      body: { message: "The connector changed during the request. Try again." },
    });
    expect(await stored(id)).toEqual({
      url: `${PUBLIC_ORIGIN}/open/mcp`,
      secrets: null,
    });
  });

  it("keeps tool policies and drops the overrides of tools that went", async () => {
    const created = await add("Docs policies", "/open/mcp");
    const id = created.body.id as string;
    const updated = await call(`/assistant/connectors/${id}`, "PATCH", {
      toolPolicies: {
        groupDefaults: { read: "approval", write: "never" },
        tools: [
          { name: "search", policy: "never" },
          { name: "gone", policy: "always" },
        ],
      },
    });
    expect(updated.body.tools).toMatchObject([
      { name: "search", policy: "never" },
      { name: "create_issue", policy: "never" },
    ]);
    const refreshed = await call(`/assistant/connectors/${id}/refresh`, "POST");
    expect(refreshed.body.toolPolicies).toEqual({
      groupDefaults: { read: "approval", write: "never" },
      tools: [{ name: "search", policy: "never" }],
    });
  });

  it("answers 404 for a connector of workspace B", async () => {
    const other = await h.as(h.b, h.outsider, (db) =>
      db
        .insert(connectors)
        .values({
          name: "B connector",
          slug: "b-connector",
          url: `${PUBLIC_ORIGIN}/open/mcp`,
          authMode: "none",
        })
        .returning({ id: connectors.id }),
    );
    for (const [path, method] of [
      ["", "GET"],
      ["/refresh", "POST"],
      ["/oauth", "POST"],
    ] as const)
      expect(
        (await call(`/assistant/connectors/${other[0]!.id}${path}`, method))
          .status,
      ).toBe(404);
    expect(edge.requests).toEqual([]);
  });
});
