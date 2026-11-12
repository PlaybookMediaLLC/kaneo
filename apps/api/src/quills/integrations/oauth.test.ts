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
import { openCredentials } from "../framework/integration-config";
import { registry } from "../framework/registry";
import quillsRouter from "../index";
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
