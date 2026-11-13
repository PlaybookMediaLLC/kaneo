import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import {
  integrationPlatformCredentials,
  integrations,
} from "../../../database/quills/schema/integrations";
import * as kaneo from "../../../database/schema";
import { decryptSecret } from "../../../notification-preferences/secrets";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import { setRole } from "../../framework/contract-probe";
import { users } from "../../framework/contract-world";
import { mintOAuthState } from "../../framework/signed";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import { bridgePage, bridgeScripts } from "../oauth-bridge";
import { signedUrl } from "../oauth-providers";
import { APP_SECRET, platformCredentials } from "../oauth-seed.fixture";
import { providerCalls, providerOverrides } from "../provider-edge.fixture";
import { TRELLO_TOKEN, trelloId } from "./trello.fixture";

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

describe.skipIf(!url)(
  "Trello connect, bridge page and lists with PostgreSQL",
  () => {
    const app = contractApp(quillsRouter, publicRouter);
    const origin = () => new URL(signedUrl("")).origin;
    const state = (
      claims: { workspaceId?: string; userId?: string; type?: string } = {},
      ttlMs?: number,
    ) =>
      mintOAuthState(
        {
          workspaceId: claims.workspaceId ?? contractEnv().a,
          userId: claims.userId ?? contractEnv().owner,
          type: claims.type ?? "trello",
        },
        ttlMs,
      );
    const signed = (path: string, value: string) =>
      `/quills-public/signed/oauth/${path}?state=${encodeURIComponent(value)}`;
    const bridge = (value: string, user = contractEnv().owner) =>
      app.request(signed("trello/bridge", value), {
        headers: { "x-test-user": user },
      });
    /** The token post as the bridge page sends it; `headers` replace or remove (undefined) a header. */
    const post = (
      value: string,
      headers: Record<string, string | undefined> = {},
      body = JSON.stringify({ token: TRELLO_TOKEN }),
    ) =>
      app.request(signed("trello/callback", value), {
        method: "POST",
        headers: Object.fromEntries(
          Object.entries({
            "content-type": "application/json",
            "x-test-user": contractEnv().owner,
            origin: origin(),
            "sec-fetch-site": "same-origin",
            ...headers,
          }).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        body,
      });
    const connection = async (workspaceId = contractEnv().a) => {
      const [row] = await contractEnv().scoped(workspaceId, (db) =>
        db
          .select({
            id: integrations.id,
            secrets: integrations.secrets,
            connectedAt: integrations.connectedAt,
          })
          .from(integrations)
          .where(eq(integrations.integrationType, "trello")),
      );
      return row;
    };
    const removeConnection = (workspaceId = contractEnv().a) =>
      contractEnv().scoped(workspaceId, (db) =>
        db
          .delete(integrations)
          .where(eq(integrations.integrationType, "trello")),
      );
    const memberCalls = () =>
      providerCalls.filter((call) =>
        call.path.startsWith("/api.trello.com/1/members/me?"),
      );
    // Every log line of this file, also of the failures; the last test reads them.
    const logs = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level),
    );

    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
      await platformCredentials(contractEnv(), contractEnv().a, "trello");
      await platformCredentials(contractEnv(), contractEnv().b, "trello");
    }, 120000);
    afterAll(async () => {
      for (const log of logs) log.mockRestore();
      await stopContract();
    });

    it("sends Trello back to the bridge page, which the credentials view names", async () => {
      const env = contractEnv();
      const start = await app.request(`/quills/${env.a}/oauth/trello/connect`, {
        headers: { "x-test-user": env.owner },
      });
      expect(start.status).toBe(200);
      const authorize = new URL(
        ((await start.json()) as { authorizeUrl: string }).authorizeUrl,
      );
      expect(`${authorize.origin}${authorize.pathname}`).toBe(
        "https://trello.com/1/authorize",
      );
      const back = new URL(authorize.searchParams.get("return_url")!);
      expect(`${back.origin}${back.pathname}`).toBe(
        signedUrl("/oauth/trello/bridge"),
      );
      expect(back.searchParams.get("state")).toMatch(/^[\w-]+\.[\w-]+$/);
      const view = await app.request(
        `/quills/${env.a}/integration-platform-credentials?type=trello`,
        { headers: { "x-test-user": env.owner } },
      );
      expect(await view.json()).toMatchObject({
        configured: true,
        redirectUri: signedUrl("/oauth/trello/bridge"),
      });
    });

    it("serves the bridge page once per state with strict headers, and the page does not use the state up", async () => {
      await removeConnection();
      const value = state();
      const page = await bridge(value);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toBe(bridgePage);
      const scripts = (text: string) =>
        [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      const hashes = bridgeScripts
        .map(
          (script) =>
            `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
        )
        .join(" ");
      const headers = {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": `default-src 'none'; script-src ${hashes}; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      };
      expect(Object.fromEntries(page.headers)).toMatchObject(headers);
      // The page's one script is a declared one, so its hash is in the policy.
      expect(scripts(html)).toEqual([bridgeScripts[0]]);
      for (const secret of [value, TRELLO_TOKEN, APP_SECRET, "client-trello"])
        expect(html).not.toContain(secret);

      // A second visit only clears the fragment; the state still completes the connect.
      const again = await bridge(value);
      expect(again.status).toBe(200);
      const used = await again.text();
      expect(used).toContain("already opened");
      expect(scripts(used)).toEqual([bridgeScripts[1]]);
      expect(Object.fromEntries(again.headers)).toMatchObject(headers);
      expect(await connection()).toBeUndefined();
      const done = await post(value);
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ status: "connected" });
      const result = new URL(done.headers.get("x-quills-result-location")!);
      expect([
        result.pathname,
        Object.fromEntries(result.searchParams),
      ]).toEqual([
        "/quills/oauth/result",
        { outcome: "connected", name: "Trello" },
      ]);
    });

    it("opens the bridge page for any state that it signed for Trello, so the page always clears the token", async () => {
      const env = contractEnv();
      // The token post refuses these; the page still takes the token out of the address.
      for (const [name, res] of [
        ["expired", await bridge(state({}, -1000))],
        ["another session", await bridge(state(), env.customerA)],
        ["no session", await bridge(state(), "")],
      ] as const) {
        expect(res.status, name).toBe(200);
        expect(await res.text(), name).toBe(bridgePage);
      }
      // A state that this instance did not sign for Trello gets no page.
      const [payload, signature] = state().split(".");
      const forged = `${Buffer.from(
        Buffer.from(payload!, "base64url").toString().replace(env.a, env.b),
      ).toString("base64url")}.${signature}`;
      for (const value of [forged, state({ type: "github" }), "not.signed"])
        expect((await bridge(value)).status, value).toBe(401);
    });

    it("connects with the checked token, seals it, and keeps it out of responses and records", async () => {
      await removeConnection();
      providerCalls.length = 0;
      const since: string = (
        await pool.query("SELECT clock_timestamp()::text AS t")
      ).rows[0].t;
      const value = state();
      const done = await post(value);
      expect(done.status).toBe(200);
      const text = await done.text();
      expect(JSON.parse(text)).toMatchObject({
        status: "connected",
        integration: {
          integrationType: "trello",
          workspaceName: "Contract",
          account: "contract",
        },
      });
      expect(text).not.toContain(TRELLO_TOKEN);
      const row = await connection();
      expect(JSON.parse(decryptSecret(row!.secrets)!)).toEqual({
        accessToken: TRELLO_TOKEN,
      });
      // One check with Trello, with the key and the token in the header, not the URL.
      expect(memberCalls()).toHaveLength(1);
      expect(memberCalls()[0]!.path).not.toContain(TRELLO_TOKEN);
      expect(memberCalls()[0]!.authorization).toBe(
        `OAuth oauth_consumer_key="client-trello", oauth_token="${TRELLO_TOKEN}"`,
      );
      // The same state again is a replay: no second write.
      const replay = await post(value);
      expect(await replay.json()).toEqual({
        status: "already_used",
        integration: null,
      });
      expect((await connection())!.connectedAt).toEqual(row!.connectedAt);

      const {
        rows: [recorded],
      } = await pool.query(
        `SELECT
          (SELECT count(*) FROM quills.audit_log WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz AND event_type='integration.connected')::int AS audit,
          (SELECT coalesce(string_agg(row_to_json(l)::text, ''), '') FROM quills.audit_log l WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz) ||
          (SELECT coalesce(string_agg(row_to_json(e)::text, ''), '') FROM quills.events e WHERE workspace_id=$1 AND occurred_at>=$2::timestamptz) ||
          (SELECT coalesce(string_agg(row_to_json(j)::text, ''), '') FROM quills.job_queue j WHERE workspace_id=$1 AND created_at>=$2::timestamptz) ||
          (SELECT coalesce(string_agg(row_to_json(k)::text, ''), '') FROM quills.kv_store k WHERE workspace_id=$1) AS text`,
        [contractEnv().a, since],
      );
      expect(recorded.audit).toBe(1);
      expect(recorded.text).toContain("integration.connected");
      expect(recorded.text).not.toContain(TRELLO_TOKEN);
    });

    it("refuses a forged, expired or foreign state, another session, a lost permission and a wrong provider", async () => {
      await removeConnection();
      const env = contractEnv();
      const ownerB = users.outsider;
      const [payload, signature] = state().split(".");
      const forged = `${Buffer.from(
        Buffer.from(payload!, "base64url").toString().replace(env.a, env.b),
      ).toString("base64url")}.${signature}`;
      const cases: [string, Response][] = [
        ["forged", await post(forged)],
        ["expired", await post(state({}, -1000))],
        [
          "workspace B in A's session",
          await post(state({ workspaceId: env.b, userId: ownerB })),
        ],
        [
          "another session",
          await post(state(), { "x-test-user": env.customerA }),
        ],
        ["no session", await post(state(), { "x-test-user": undefined })],
        ["a GitHub state", await post(state({ type: "github" }))],
      ];
      for (const [name, res] of cases) expect(res.status, name).toBe(401);
      // The state's account in its own session, without the right in that workspace: workspace B
      // (A's owner is no member there), a removed member, and a member who lost the permission.
      expect(
        (await post(state({ workspaceId: env.b, userId: env.owner }))).status,
      ).toBe(403);
      expect(
        (
          await post(state({ userId: users.removed }), {
            "x-test-user": users.removed,
          })
        ).status,
      ).toBe(403);
      // The code callback never takes a Trello token from the query.
      const code = await app.request(
        `${signed("trello/callback", state())}&code=${TRELLO_TOKEN}`,
        { headers: { "x-test-user": env.owner } },
      );
      expect(code.status).toBe(400);
      await setRole({ workspace: ["read"], quills: ["read"] });
      expect(
        (
          await post(state({ userId: users.limited }), {
            "x-test-user": users.limited,
          })
        ).status,
      ).toBe(403);
      expect(await connection()).toBeUndefined();
      expect(await connection(env.b)).toBeUndefined();
    });

    it("takes the token only from the bridge page of this instance", async () => {
      await removeConnection();
      providerCalls.length = 0;
      for (const headers of [
        { origin: undefined },
        { origin: "https://other.example" },
        { origin: "null" },
        { "sec-fetch-site": "cross-site" },
        { "sec-fetch-site": "same-site" },
      ])
        expect(
          (await post(state(), headers)).status,
          JSON.stringify(headers),
        ).toBe(401);
      expect(memberCalls()).toEqual([]);
      expect(await connection()).toBeUndefined();
      // A browser that sends no Sec-Fetch-Site still passes with the right Origin.
      expect(
        (await post(state(), { "sec-fetch-site": undefined })).status,
      ).toBe(200);
    });

    it("answers fixed errors for a token that Trello refuses or a malformed answer, and keeps the state usable", async () => {
      await removeConnection();
      const value = state();
      providerOverrides.set("GET /api.trello.com/1/members/me", {
        status: 401,
      });
      try {
        const res = await post(value);
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          message: "The provider rejected the saved credentials. Reconnect.",
        });
      } finally {
        providerOverrides.clear();
      }
      providerOverrides.set("GET /api.trello.com/1/members/me", {
        status: 200,
        body: { message: "provider text" },
      });
      try {
        const res = await post(value);
        expect(res.status).toBe(400);
        expect(await res.text()).not.toContain("provider text");
      } finally {
        providerOverrides.clear();
      }
      // Trello does not answer.
      providerOverrides.set("GET /api.trello.com/1/members/me", "drop");
      try {
        expect((await post(value)).status).toBe(502);
      } finally {
        providerOverrides.clear();
      }
      providerCalls.length = 0;
      for (const token of ['a"b', "x".repeat(2049)]) {
        const res = await post(value, {}, JSON.stringify({ token }));
        expect(res.status).toBe(400);
        expect(await res.text()).not.toContain(token);
      }
      // No OAuth app saved: 409 before any call.
      const env = contractEnv();
      await env.scoped(env.a, (db) =>
        db
          .delete(integrationPlatformCredentials)
          .where(eq(integrationPlatformCredentials.integrationType, "trello")),
      );
      try {
        expect((await post(value)).status).toBe(409);
      } finally {
        await platformCredentials(env, env.a, "trello");
      }
      expect(memberCalls()).toEqual([]);
      expect(await connection()).toBeUndefined();
      // No failure used the state up.
      expect((await post(value)).status).toBe(200);
    });

    it("lists the boards and the lists of a listed board, and refuses a board it does not list", async () => {
      const env = contractEnv();
      await removeConnection();
      expect((await post(state())).status).toBe(200);
      const { id } = (await connection())!;
      const destinations = async (query = "") => {
        const res = await app.request(
          `/quills/${env.a}/integrations/${id}/destinations${query}`,
          { headers: { "x-test-user": env.owner } },
        );
        return { status: res.status, body: await res.json() };
      };
      const boards = [
        { id: trelloId(1), name: "Roadmap" },
        { id: trelloId(2), name: "Support" },
      ];
      expect(await destinations()).toEqual({
        status: 200,
        body: { destinations: boards },
      });
      expect(await destinations("?kind=board")).toEqual({
        status: 200,
        body: { destinations: boards },
      });
      expect(await destinations(`?kind=list&parent=${trelloId(1)}`)).toEqual({
        status: 200,
        body: { destinations: [{ id: trelloId(11), name: "Inbox" }] },
      });
      providerCalls.length = 0;
      expect(
        (await destinations(`?kind=list&parent=${trelloId(99)}`)).status,
      ).toBe(404);
      expect(
        providerCalls.filter((call) => call.path.includes("/lists")),
      ).toEqual([]);
      for (const query of ["?kind=list", "?kind=board&parent=x", "?kind=card"])
        expect((await destinations(query)).status, query).toBe(400);
      // Workspace B's owner cannot list A's connection.
      const foreign = await app.request(
        `/quills/${env.b}/integrations/${id}/destinations`,
        { headers: { "x-test-user": users.outsider } },
      );
      expect(foreign.status).toBe(404);
    });

    it("writes the token to no log line, also on the failures above", () => {
      for (const log of logs)
        expect(JSON.stringify(log.mock.calls)).not.toContain(TRELLO_TOKEN);
    });
  },
);
