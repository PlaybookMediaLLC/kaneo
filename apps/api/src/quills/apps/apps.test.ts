import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Client, Pool } from "pg";
import { createId } from "@kaneo/ids";
import { apps } from "../../database/quills/schema/apps";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import * as kaneo from "../../database/schema";
import { httpExceptionResponse } from "../../errors/http-exception-response";
import type { BaseVariables } from "../../openapi";
import { authenticateApiRequest } from "../../utils/authenticate-api-request";
import { provider } from "../assistant/provider-edge.fixture";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { role, users } from "../framework/contract-world";
import quillsRouter from "../index";
import { connection } from "../integrations/seed.fixture";
import "./index.fixture";
import { appSeed } from "./seed.fixture";

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
const app = contractApp(quillsRouter);
// Real API-key authentication in front of the Quills router: the minted secret, end to end.
const real = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
real.use("*", async (c, next) => {
  await authenticateApiRequest(c);
  await next();
});
real.onError((error) =>
  error instanceof HTTPException
    ? httpExceptionResponse(error)
    : Response.json({ message: String(error) }, { status: 500 }),
);
real.route("/quills", quillsRouter);

const full = {
  workspace: ["read"],
  quills: ["read", "create", "update", "delete", "manage_settings"],
};
type Sent = { status: number; body: any; text: string };
async function send(
  target: Hono<any>,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Sent> {
  const res = await target.request(`/quills/${contractEnv().a}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON.
  }
  return { status: res.status, body: parsed, text };
}
/** A teammate's session, or with `key`, the teammate's API key ("app": the key that an app of A holds). */
const as = (
  method: string,
  path: string,
  body?: unknown,
  options: { user?: string; key?: "teammate" | "app" } = {},
) =>
  send(
    app,
    method,
    path,
    {
      "x-test-user": options.user ?? contractEnv().owner,
      ...(options.key && { "x-test-scope": JSON.stringify(full) }),
      ...(options.key === "app" && { "x-test-key": "app" }),
    },
    body,
  );
const withSecret = (secret: string, method: string, path: string) =>
  send(real, method, path, { authorization: `Bearer ${secret}` });
const keyRow = async (id: string) =>
  (
    await pool.query(
      "SELECT reference_id AS owner, permissions, name FROM public.apikey WHERE id=$1",
      [id],
    )
  ).rows[0] as
    | { owner: string; permissions: string | null; name: string }
    | undefined;
/** A trigger that fails `table`'s `event` when `condition` holds; dropped by the returned function. */
async function failing(table: string, event: string, condition: string) {
  const name = `x1_fail_${table.replace(/\W/g, "_")}_${event.toLowerCase()}`;
  await pool.query(
    `CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION public.${name}()`,
  );
  return async () => {
    await pool.query(`DROP TRIGGER ${name} ON ${table}`);
    await pool.query(`DROP FUNCTION public.${name}()`);
  };
}

describe.skipIf(!url)("Sidebar apps", () => {
  beforeAll(async () => {
    process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
      "quills-contract-test-key";
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("binds a key once in each workspace, with one credential, through the runtime role", async () => {
    const env = contractEnv();
    const bind = (workspaceId: string, values: object = {}) =>
      env.scoped(workspaceId, (db) =>
        db.insert(apps).values({
          id: createId("app"),
          name: "Bound",
          apiKeyId: "x1_shared_key",
          ...values,
        }),
      );
    // Two parallel binds of one key: the unique index lets one through.
    const binds = await Promise.allSettled([bind(env.a), bind(env.a)]);
    expect(binds.map((one) => one.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      binds.find((one) => one.status === "rejected")!.reason.cause,
    ).toMatchObject({ constraint: "apps_api_key_id_idx" });
    // The same key in another workspace is a separate binding.
    await expect(bind(env.b)).resolves.toBeDefined();
    await expect(
      bind(env.a, { apiKeyId: "x1_other", oauthClientId: "client" }),
    ).rejects.toMatchObject({ cause: { constraint: "apps_credential_check" } });
    // A row for workspace B written from A's scope fails the row-security check.
    await expect(
      bind(env.a, { apiKeyId: "x1_foreign", workspaceId: env.b }),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    const { rows } = await pool.query(
      "SELECT workspace_id FROM quills.apps WHERE api_key_id LIKE 'x1_%' ORDER BY 1",
    );
    expect(rows.map((row) => row.workspace_id)).toEqual([env.a, env.b]);
    await pool.query("DELETE FROM quills.apps WHERE api_key_id LIKE 'x1_%'");
  });

  it("registers apps only with a session: an API key cannot mint or rescope a key", async () => {
    const before = (
      await pool.query("SELECT count(*)::int AS n FROM public.apikey")
    ).rows[0].n;
    const body = { name: "By key", grantedScopes: ["read:feedback"] };
    const scoped = await as("POST", "/app-registrations", body, {
      key: "teammate",
    });
    const unscoped = await send(
      app,
      "POST",
      "/app-registrations",
      { "x-test-user": contractEnv().owner, "x-test-scope": "null" },
      body,
    );
    for (const res of [scoped, unscoped])
      expect([res.status, res.body.code]).toEqual([403, "SESSION_REQUIRED"]);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM public.apikey")).rows[0]
        .n,
    ).toBe(before);
    const { id } = (await as("POST", "/app-registrations", body)).body;
    const rescope = await as(
      "PATCH",
      `/app-registrations/${id}`,
      { grantedScopes: ["read:feedback", "write:feedback"] },
      { key: "teammate" },
    );
    expect([rescope.status, rescope.body.code]).toEqual([
      403,
      "SESSION_REQUIRED",
    ]);
  });

  it("refuses a requester whose email belongs to a teammate", async () => {
    const env = contractEnv();
    const ids = await appSeed(env);
    // The owner's portal profile, with the email that a requester gives.
    await env.portalCustomer(env.a, env.owner);
    const teammate = { email: `${env.owner}@example.test` };
    await pool.query(
      "UPDATE quills.customer_identity SET email=$1 WHERE workspace_id=$2 AND kaneo_user_id=$3",
      [teammate.email, env.a, env.owner],
    );
    const linked = await as(
      "PUT",
      "/apps/links",
      {
        postId: ids.a.postId,
        externalType: "zendesk",
        externalKey: "T-teammate",
        requester: teammate,
      },
      { key: "app" },
    );
    const created = await as(
      "POST",
      "/apps/posts",
      { boardId: ids.a.boardId, title: "As a teammate", requester: teammate },
      { key: "app" },
    );
    expect([linked.status, created.status]).toEqual([409, 409]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quills.post_external_links WHERE workspace_id=$1 AND external_id='T-teammate'",
          [env.a],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("mints a key that works only on the app routes of this workspace's Quills API, and stops it when the app is disabled", async () => {
    const created = await as("POST", "/app-registrations", {
      name: "Zendesk",
      grantedScopes: ["read:feedback", "write:feedback"],
    });
    expect(created.status).toBe(200);
    const { secret, apiKeyId, id } = created.body;
    expect(secret).toMatch(/^[A-Za-z]{64}$/);
    expect(await keyRow(apiKeyId)).toEqual({
      owner: contractEnv().owner,
      permissions: JSON.stringify({
        workspace: ["read"],
        quills: ["read", "create", "update"],
      }),
      name: "App Zendesk",
    });
    expect((await withSecret(secret, "GET", "/apps/boards")).status).toBe(200);
    const confined = await withSecret(secret, "GET", "/context");
    expect([confined.status, confined.body.code]).toEqual([
      403,
      "APP_KEY_CONFINED",
    ]);

    expect(
      (await as("PATCH", `/app-registrations/${id}`, { status: "disabled" }))
        .status,
    ).toBe(200);
    const disabled = await withSecret(secret, "GET", "/apps/boards");
    expect([disabled.status, disabled.body.code]).toEqual([
      403,
      "APP_NOT_BOUND",
    ]);
    // A disabled app's key does not get its teammate access back.
    expect((await withSecret(secret, "GET", "/context")).body.code).toBe(
      "APP_KEY_CONFINED",
    );
    await as("PATCH", `/app-registrations/${id}`, { status: "active" });
    expect((await withSecret(secret, "GET", "/apps/boards")).status).toBe(200);

    // The secret is in no audit row and no event.
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM quills.audit_log WHERE metadata::text LIKE '%' || $1 || '%')::int
            + (SELECT count(*) FROM quills.events WHERE payload::text LIKE '%' || $1 || '%')::int AS n`,
      [secret],
    );
    expect(rows[0].n).toBe(0);
  });

  it("deletes the minted key when the app row does not commit, and never returns its secret", async () => {
    const { auth } = await import("../../auth");
    const mint = vi.spyOn(auth.api, "createApiKey");
    const drop = await failing(
      "quills.apps",
      "INSERT",
      "NEW.name = 'fail-bind'",
    );
    try {
      const res = await as("POST", "/app-registrations", {
        name: "fail-bind",
        grantedScopes: ["read:feedback"],
      });
      expect(res.status).toBe(500);
      const minted = (await mint.mock.results[0]!.value) as {
        id: string;
        key: string;
      };
      expect(res.text).not.toContain(minted.key);
      expect(await keyRow(minted.id)).toBeUndefined();
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM quills.apps WHERE name='fail-bind'",
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      mint.mockRestore();
      await drop();
    }
  });

  it("leaves the key unbound and its secret unknown when the undo fails too", async () => {
    const { auth } = await import("../../auth");
    const mint = vi.spyOn(auth.api, "createApiKey");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const dropBind = await failing(
      "quills.apps",
      "INSERT",
      "NEW.name = 'fail-undo'",
    );
    const dropUndo = await failing(
      "public.apikey",
      "DELETE",
      "OLD.name = 'App fail-undo'",
    );
    try {
      const res = await as("POST", "/app-registrations", {
        name: "fail-undo",
        grantedScopes: ["read:feedback"],
      });
      expect(res.status).toBe(500);
      const minted = (await mint.mock.results[0]!.value) as {
        id: string;
        key: string;
      };
      // The key stays, with no app: no response and no log line holds its secret.
      expect(await keyRow(minted.id)).toBeDefined();
      expect(res.text).not.toContain(minted.key);
      expect(logged).toHaveBeenCalledWith(
        "createQuillsAppRegistration: revert failed",
        expect.anything(),
      );
      const text = (value: unknown): string =>
        value instanceof Error
          ? `${value.message} ${value.stack} ${text(value.cause)}`
          : String(value);
      expect(logged.mock.calls.flat().map(text).join(" ")).not.toContain(
        minted.key,
      );
      const unbound = await withSecret(minted.key, "GET", "/apps/boards");
      expect(unbound.body.code).toBe("APP_NOT_BOUND");
    } finally {
      mint.mockRestore();
      logged.mockRestore();
      await dropUndo();
      await dropBind();
      await pool.query("DELETE FROM public.apikey WHERE name='App fail-undo'");
    }
  });

  it("confines a key with one indexed lookup, and reads no binding for a session", async () => {
    const env = contractEnv();
    // Enough bindings, with fresh statistics, that the planner picks the index on its own.
    await pool.query(
      `INSERT INTO quills.apps (workspace_id, id, name, api_key_id)
       SELECT $1, 'app_x1_' || n, 'Load', 'x1_key_' || n FROM generate_series(1, 5000) n`,
      [env.a],
    );
    await pool.query("ANALYZE quills.apps");
    const query = vi.spyOn(Client.prototype, "query");
    const onApps = () =>
      query.mock.calls
        .map(([config, values]) => {
          const query = (
            typeof config === "string" ? { text: config } : config
          ) as { text: string; values?: unknown };
          return {
            text: query.text,
            values: (query.values ?? values) as unknown[] | undefined,
          };
        })
        .filter(({ text }) => text?.includes('"quills"."apps"'));
    try {
      expect((await as("GET", "/context")).status).toBe(200);
      expect(onApps()).toEqual([]);
      query.mockClear();
      expect(
        (await as("GET", "/context", undefined, { key: "teammate" })).status,
      ).toBe(200);
      const lookups = onApps();
      expect(lookups).toHaveLength(1);
      query.mockRestore();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('quills.workspace_id', $1, true)",
          [env.a],
        );
        await client.query("SET LOCAL ROLE quills_runtime");
        const plan = JSON.stringify(
          (
            await client.query({
              text: `EXPLAIN (FORMAT JSON) ${lookups[0]!.text}`,
              values: lookups[0]!.values,
            })
          ).rows[0],
        );
        expect(plan).toContain('"Index Name":"apps_api_key_id_idx"');
        expect(plan).toMatch(/"Index Cond":"[^"]*api_key_id = /);
        expect(plan).not.toContain("Seq Scan");
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    } finally {
      query.mockRestore();
      await pool.query("DELETE FROM quills.apps WHERE id LIKE 'app_x1_%'");
    }
  });

  it("suggests by embedding, falls back to text search, and never calls the provider for an unbound key", async () => {
    const ids = await appSeed(contractEnv());
    const path = `/apps/suggest?text=${ids.a.title}&limit=20`;
    const ranked = await as("GET", path, undefined, { key: "app" });
    expect(ranked.body.items[0]).toMatchObject({
      id: ids.a.postId,
      similarity: 1,
    });
    expect(provider.requests.at(-1)!.body.input).toEqual([ids.a.title]);
    expect(ranked.text).not.toContain(ids.b.postId);

    provider.reply(() => ({ status: 500, json: { error: "down" } }));
    try {
      // Ticket text: a post that holds one of its words is a match.
      const text = encodeURIComponent(
        `Hello, the ${ids.a.title} export times out for our team`,
      );
      const fallback = await as(
        "GET",
        `/apps/suggest?text=${text}&limit=20`,
        undefined,
        { key: "app" },
      );
      expect(fallback.body.items).toContainEqual(
        expect.objectContaining({ id: ids.a.postId, similarity: null }),
      );
      expect(fallback.text).not.toContain(ids.b.postId);
    } finally {
      provider.reply();
    }

    const calls = provider.requests.length;
    const unbound = await as("GET", path, undefined, { key: "teammate" });
    expect(unbound.body.code).toBe("APP_NOT_BOUND");
    expect(provider.requests.length).toBe(calls);
  });

  it("links once, keeps the vote on unlink, and touches only the app's links", async () => {
    const env = contractEnv();
    const ids = await appSeed(env);
    const requester = { email: `${env.id("asker")}@example.test` };
    const body = {
      postId: ids.a.postId,
      externalType: "zendesk",
      externalKey: "T-1",
      requester,
    };
    const first = await as("PUT", "/apps/links", body, { key: "app" });
    expect(first.body).toMatchObject({
      linked: true,
      voted: true,
      voteCount: 1000001,
      votedPostId: ids.a.postId,
    });
    const again = await as("PUT", "/apps/links", body, { key: "app" });
    expect(again.body).toMatchObject({
      linkId: first.body.linkId,
      linked: false,
      voted: false,
      voteCount: 1000001,
    });
    const counts = async () =>
      (
        await pool.query(
          `SELECT (SELECT count(*) FROM quills.post_external_links WHERE workspace_id=$1 AND external_id='T-1')::int AS links,
                  (SELECT count(*) FROM quills.post_votes v JOIN quills.principal p ON p.id=v.principal_id AND p.workspace_id=v.workspace_id
                     JOIN quills.customer_identity c ON c.id=p.user_id AND c.workspace_id=p.workspace_id
                     WHERE v.workspace_id=$1 AND c.email=$2)::int AS votes`,
          [env.a, requester.email],
        )
      ).rows[0];
    expect(await counts()).toEqual({ links: 1, votes: 1 });

    const unlink = `/apps/links?postId=${ids.a.postId}&externalType=zendesk&externalKey=T-1`;
    expect(
      (await as("DELETE", unlink, undefined, { key: "app" })).body,
    ).toEqual({
      changed: true,
    });
    expect(await counts()).toEqual({ links: 0, votes: 1 });
    expect(
      (await as("DELETE", unlink, undefined, { key: "app" })).body,
    ).toEqual({
      changed: false,
    });

    for (const externalType of ["live_chat", "import"])
      expect(
        (
          await as(
            "PUT",
            "/apps/links",
            { ...body, externalType },
            { key: "app" },
          )
        ).status,
      ).toBe(400);

    // An integration's links to the same item: not listed, not removed, and no app link beside them.
    const integration = await connection(env, env.a, "shortcut");
    await env.scoped(env.a, (db) =>
      db.insert(postExternalLinks).values([
        {
          postId: ids.a.postId,
          integrationId: integration.id,
          integrationType: "zendesk",
          externalId: "T-2",
        },
        {
          postId: ids.a.postId,
          integrationId: integration.id,
          integrationType: "zendesk",
          externalId: "T-2",
          syncScope: "install:dest",
        },
      ]),
    );
    const listed = await as(
      "GET",
      "/apps/links?externalType=zendesk&externalKey=T-2",
      undefined,
      { key: "app" },
    );
    expect(listed.body).toEqual({ items: [] });
    const owned = await as(
      "PUT",
      "/apps/links",
      { ...body, externalKey: "T-2", requester: undefined },
      { key: "app" },
    );
    expect(owned.status).toBe(409);
    expect(
      (
        await as(
          "DELETE",
          `/apps/links?postId=${ids.a.postId}&externalType=zendesk&externalKey=T-2`,
          undefined,
          { key: "app" },
        )
      ).body,
    ).toEqual({ changed: false });
  });

  it("rescopes an app's key within the caller's own Quills actions", async () => {
    const created = await as("POST", "/app-registrations", {
      name: "Rescope",
      grantedScopes: ["read:feedback"],
    });
    const { id, apiKeyId } = created.body;
    const scope = async () =>
      JSON.parse((await keyRow(apiKeyId))!.permissions!).quills;
    expect(await scope()).toEqual(["read"]);
    const widened = await as("PATCH", `/app-registrations/${id}`, {
      grantedScopes: ["read:feedback", "write:feedback"],
    });
    expect(widened.body.grantedScopes).toEqual([
      "read:feedback",
      "write:feedback",
    ]);
    expect(await scope()).toEqual(["read", "create", "update"]);

    // A manager who cannot write feedback cannot give an app that power.
    await pool.query(
      "UPDATE public.workspace_role SET permission=$1 WHERE workspace_id=$2 AND role=$3",
      [
        JSON.stringify({
          workspace: ["read"],
          quills: ["read", "manage_settings"],
        }),
        contractEnv().a,
        role,
      ],
    );
    const narrowed = await as(
      "PATCH",
      `/app-registrations/${id}`,
      { grantedScopes: ["read:feedback"] },
      { user: users.limited },
    );
    expect(narrowed.status).toBe(200);
    expect(await scope()).toEqual(["read"]);
    const denied = await as(
      "PATCH",
      `/app-registrations/${id}`,
      { grantedScopes: ["write:feedback"] },
      { user: users.limited },
    );
    expect([denied.status, denied.body.code]).toEqual([
      403,
      "MISSING_PERMISSION",
    ]);
    expect(await scope()).toEqual(["read"]);
  });
});
