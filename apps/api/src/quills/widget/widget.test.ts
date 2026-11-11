import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { resolveLocale } from "./config";
import { enableWidget, pairingCode, signIdentity } from "./seed.fixture";

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
const app = contractApp(quillsRouter, publicRouter);
const exp = () => Math.floor(Date.now() / 1000) + 300;

async function call(
  method: string,
  path: string,
  options: { bearer?: string; body?: unknown; workspace?: string } = {},
) {
  const res = await app.request(
    `/quills-public/${options.workspace ?? contractEnv().a}${path}`,
    {
      method,
      headers: {
        ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
        ...(options.body !== undefined && {
          "content-type": "application/json",
        }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("widget locale", () => {
  it("prefers a supported explicit locale, then Accept-Language weights", () => {
    expect(resolveLocale(null, "fr-CA")).toBe("fr");
    expect(resolveLocale("de;q=0.5, nl;q=0.9, xx", "unknown")).toBe("nl");
    expect(resolveLocale("zh-HK", undefined)).toBe("zh-tw");
    expect(resolveLocale("pt-PT, en;q=0", undefined)).toBe("pt-br");
    expect(resolveLocale("en;q=0, xx", undefined)).toBe("en");
  });
});

describe.skipIf(!url)("Quills widget identity", () => {
  let secret: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    secret = await enableWidget(contractEnv(), contractEnv().a);
  }, 120000);
  afterAll(() => stopContract());

  it("identifies a visitor and stores only the hash of its session token", async () => {
    const env = contractEnv();
    const sub = env.id("sub");
    const first = await call("POST", "/widget/identify", {
      body: {
        ssoToken: signIdentity(
          { sub, email: `${sub}@Example.test`, exp: exp() },
          secret,
        ),
      },
    });
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ email: `${sub}@example.test` });
    const token = first.body.sessionToken as string;
    const stored = await pool.query(
      "SELECT key, value::text FROM quills.kv_store WHERE workspace_id=$1 AND key LIKE 'widget:session:%'",
      [env.a],
    );
    const hash = createHash("sha256").update(token).digest("hex");
    expect(stored.rows.map((row) => row.key)).toContain(
      `widget:session:${hash}`,
    );
    expect(JSON.stringify(stored.rows)).not.toContain(token);

    const session = await call("GET", "/widget/session", { bearer: token });
    expect(session.body.user).toMatchObject({ id: first.body.user.id });
    expect(
      (await call("GET", "/widget/session", { bearer: `${token}x` })).status,
    ).toBe(401);

    // The same signed sub with a new email updates the same customer.
    const second = await call("POST", "/widget/identify", {
      body: {
        ssoToken: signIdentity(
          { sub, email: `new-${sub}@example.test`, exp: exp() },
          secret,
        ),
      },
    });
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.principalId).toBe(first.body.principalId);

    // Another visitor cannot take that email.
    const other = env.id("sub");
    const taken = await call("POST", "/widget/identify", {
      body: {
        ssoToken: signIdentity(
          { sub: other, email: `${other}@example.test`, exp: exp() },
          secret,
        ),
      },
    });
    expect(taken.status).toBe(200);
    const clash = await call("POST", "/widget/identify", {
      body: {
        ssoToken: signIdentity(
          { sub: other, email: `new-${sub}@example.test`, exp: exp() },
          secret,
        ),
      },
    });
    expect(clash.status).toBe(409);

    // A blocked person cannot identify, and their sessions stop working.
    await env.scoped(env.a, (db) =>
      db
        .update(principal)
        .set({ blockedAt: new Date() })
        .where(eq(principal.id, first.body.principalId)),
    );
    expect(
      (await call("GET", "/widget/session", { bearer: token })).status,
    ).toBe(403);
    const blocked = await call("POST", "/widget/identify", {
      body: {
        ssoToken: signIdentity(
          { sub, email: `new-${sub}@example.test`, exp: exp() },
          secret,
        ),
      },
    });
    expect(blocked.status).toBe(403);
  });

  it("keeps the signed sub ahead of an email match, and serializes a first visit", async () => {
    const env = contractEnv();
    const sub = env.id("sub");
    const identify = (claims: Record<string, unknown>) =>
      call("POST", "/widget/identify", {
        body: { ssoToken: signIdentity({ exp: exp(), ...claims }, secret) },
      });
    // Two tabs identify a new visitor at once: one customer, no error.
    const [one, two] = await Promise.all([
      identify({ sub, email: `${sub}@example.test` }),
      identify({ sub, email: `${sub}@example.test` }),
    ]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(one.body.user.id).toBe(two.body.user.id);
    // A teammate-made customer holds another email and has no external ID.
    const taken = `${env.id("taken")}@example.test`;
    await env.scoped(env.a, (db) =>
      db.insert(customer).values({ name: "Directory", email: taken }),
    );
    expect((await identify({ sub, email: taken })).status).toBe(409);
    // A numeric id stands in for sub; a bad optional claim is dropped.
    const numeric = await identify({
      id: 4242,
      email: `${env.id("num")}@example.test`,
      name: "",
      avatarUrl: "/relative.png",
    });
    expect(numeric.status).toBe(200);
    expect(numeric.body.user.avatarUrl).toBeNull();
  });

  it("ends widget sessions when the secret rotates or the widget turns off", async () => {
    const env = contractEnv();
    const visitor = await env.widgetVisitor(env.a);
    const session = () =>
      call("GET", "/widget/session", { bearer: visitor.token });
    expect((await session()).status).toBe(200);
    await env.scoped(env.a, (db) =>
      db
        .update(settings)
        .set({ widgetConfig: JSON.stringify({ enabled: false }) }),
    );
    expect((await session()).status).toBe(401);
    await env.scoped(env.a, (db) =>
      db
        .update(settings)
        .set({ widgetConfig: JSON.stringify({ enabled: true }) }),
    );
    expect((await session()).status).toBe(200);
    const rotated = await app.request(
      `/quills/${env.a}/settings/widget/secret`,
      { method: "POST", headers: { "x-test-user": env.owner } },
    );
    expect(rotated.status).toBe(200);
    expect((await session()).status).toBe(401);
    secret = ((await rotated.json()) as { secret: string }).secret;
  });

  it("refuses identify while the widget is off", async () => {
    const env = contractEnv();
    await env.scoped(env.a, (db) =>
      db
        .update(settings)
        .set({ widgetConfig: JSON.stringify({ enabled: false }) }),
    );
    const sub = env.id("sub");
    const res = await call("POST", "/widget/identify", {
      body: {
        ssoToken: signIdentity(
          { sub, email: `${sub}@example.test`, exp: exp() },
          secret,
        ),
      },
    });
    expect(res.status).toBe(403);
    expect((await call("GET", "/widget/config.json")).body).toEqual({
      enabled: false,
      config: null,
    });
  });

  it("redeems an install code at most twice and turns the widget on", async () => {
    const env = contractEnv();
    const code = await pairingCode(env, env.a);
    const first = await call("POST", "/widget/install-context", {
      body: { code },
    });
    expect(first.body).toEqual({ signingSecret: secret });
    expect((await call("GET", "/widget/config.json")).body.enabled).toBe(true);
    expect(
      (await call("POST", "/widget/install-context", { body: { code } }))
        .status,
    ).toBe(200);
    expect(
      (await call("POST", "/widget/install-context", { body: { code } }))
        .status,
    ).toBe(404);
    // A code of workspace A means nothing in workspace B.
    const other = await pairingCode(env, env.a);
    expect(
      (
        await call("POST", "/widget/install-context", {
          body: { code: other },
          workspace: env.b,
        })
      ).status,
    ).toBe(404);
  });
});
