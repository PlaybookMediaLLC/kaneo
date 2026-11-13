import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { integrationPlatformCredentials as platform } from "../../database/quills/schema/integrations";
import * as kaneo from "../../database/schema";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import {
  openCredentials,
  ProviderCallError,
} from "../framework/integration-config";
import { registry } from "../framework/registry";
import quillsRouter from "../index";
import { expiresAt, refreshGrant } from "./oauth-providers";
import { oauthProvider, oauthTypes } from "./providers";

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
const url = process.env.QUILLS_TEST_DATABASE_URL;

describe("OAuth connect routes", () => {
  it("names the provider in each connect summary", () => {
    void quillsRouter;
    const summaries = Object.fromEntries(
      [...registry.keys()]
        .filter((d) => /^\/oauth\/[^/]+\/connect$/.test(d.path))
        .map((d) => [d.path.split("/")[2], d.summary]),
    );
    expect(summaries).toEqual(
      Object.fromEntries(
        oauthTypes.map((type) => [
          type,
          `Start the ${oauthProvider(type)!.name} OAuth connection`,
        ]),
      ),
    );
  });

  it("declares sanitized browser result locations for success and failure", () => {
    void quillsRouter;
    const route = [...registry.keys()].find(
      (declaration) => declaration.operationId === "completeQuillsOAuthConnect",
    )!;
    const input = { params: { type: "github" }, query: {} } as never;
    for (const url of [
      route.redirect!.success(
        { status: "connected", integration: null },
        input,
      ),
      route.redirect!.failure(502, input),
    ]) {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/quills/oauth/result");
      expect([...parsed.searchParams.keys()].sort()).toEqual([
        "name",
        "outcome",
      ]);
      expect(parsed.searchParams.get("name")).toBe("GitHub");
    }
  });
});

describe("shared token helpers", () => {
  it("reads the expiry from expires_in, and gives none without a number", () => {
    const at = Date.parse(expiresAt({ expires_in: 3600 }));
    expect(at - Date.now()).toBeGreaterThan(3590_000);
    expect(at - Date.now()).toBeLessThanOrEqual(3600_000);
    expect(expiresAt({})).toBe("");
    expect(expiresAt({ expires_in: "soon" })).toBe("");
  });
  it("maps a refused refresh to 401, keeps the stored refresh token and refuses an answer without a token", async () => {
    const status = (promise: Promise<unknown>) =>
      promise.then(
        () => "resolved",
        (error: unknown) =>
          error instanceof ProviderCallError ? error.status : error,
      );
    expect(
      await status(
        refreshGrant(Promise.reject(new ProviderCallError(400)), {}),
      ),
    ).toBe(401);
    expect(
      await status(
        refreshGrant(Promise.reject(new ProviderCallError(503)), {}),
      ),
    ).toBe(503);
    expect(await status(refreshGrant(Promise.resolve({}), {}))).toBe(401);
    expect(
      await refreshGrant(Promise.resolve({ access_token: "next" }), {
        refreshToken: "stored",
      }),
    ).toEqual({ accessToken: "next", refreshToken: "stored", expiresAt: "" });
    expect(
      await refreshGrant(
        Promise.resolve({ access_token: "next", refresh_token: "rotated" }),
        {},
        () => "fixed",
      ),
    ).toEqual({
      accessToken: "next",
      refreshToken: "rotated",
      expiresAt: "fixed",
    });
  });
});

describe.skipIf(!url)("OAuth platform credentials with PostgreSQL", () => {
  const app = contractApp(quillsRouter);
  beforeAll(async () => {
    process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||=
      "quills-contract-test-key";
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  const save = (extra: Record<string, unknown>) =>
    app.request(`/quills/${contractEnv().a}/integration-platform-credentials`, {
      method: "PUT",
      headers: {
        "x-test-user": contractEnv().owner,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "slack",
        client: { id: "slack-client", secret: "slack-client-secret" },
        ...extra,
      }),
    });
  const stored = () =>
    contractEnv().scoped(contractEnv().a, async (db) => {
      const [row] = await db
        .select({ secrets: platform.secrets })
        .from(platform)
        .where(eq(platform.integrationType, "slack"));
      return openCredentials(row!.secrets)?.signingSecret;
    });

  it("keeps the Slack signing secret when a save omits it, and clears it on an empty value or null", async () => {
    expect((await save({ signingSecret: "signing-one" })).status).toBe(200);
    expect(await stored()).toBe("signing-one");
    expect((await save({})).status).toBe(200);
    expect(await stored()).toBe("signing-one");
    expect((await save({ signingSecret: "" })).status).toBe(200);
    expect(await stored()).toBeUndefined();
    expect((await save({ signingSecret: "signing-two" })).status).toBe(200);
    expect((await save({ signingSecret: null })).status).toBe(200);
    expect(await stored()).toBeUndefined();
  });
});
