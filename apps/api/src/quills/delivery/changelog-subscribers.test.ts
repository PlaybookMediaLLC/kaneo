import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { principal, user } from "../../database/quills/schema/auth";
import type { BaseVariables } from "../../openapi";
import router from "..";
import { harness } from "../jobs/handlers/harness.fixture";

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
vi.mock("../../ws", () => ({ broadcastToUserAndWait: vi.fn(async () => {}) }));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("changelog");
const app = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
app.use("*", async (c, next) => {
  c.set("userId", h.owner);
  c.set("user", null);
  await next();
});
app.route("/quills", router);
const call = (path: string, method = "GET", body?: object) =>
  app.request(`/quills/${h.a}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body && JSON.stringify(body),
  });

describe.skipIf(!url)("Quills changelog subscriber import", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  it("subscribes matching customers and never re-subscribes one who opted out", async () => {
    const email = (label: string) => `${label}-${h.a}@example.test`;
    const person = (label: string) =>
      h.system(h.a, async (db) => {
        const [identity] = await db
          .insert(user)
          .values({ name: label, email: email(label) })
          .returning({ id: user.id });
        const [row] = await db
          .insert(principal)
          .values({
            userId: identity!.id,
            displayName: label,
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        return row!.id;
      });
    const optedOut = await person("opted-out");
    const fresh = await person("fresh");
    expect(
      (
        await call(`/changelog-subscribers/${optedOut}`, "PUT", {
          subscribed: false,
        })
      ).status,
    ).toBe(200);

    const imported = await call("/changelog-subscribers/import", "POST", {
      emails: [
        email("opted-out").toUpperCase(),
        email("fresh"),
        "nobody@example.test",
      ],
    });
    expect(await imported.json()).toEqual({
      imported: 1,
      skipped: 2,
      total: 3,
    });
    expect(
      await (await call(`/changelog-subscribers/${optedOut}`)).json(),
    ).toMatchObject({ subscribed: false, source: "admin" });
    expect(
      await (await call(`/changelog-subscribers/${fresh}`)).json(),
    ).toMatchObject({ subscribed: true, source: "csv_import" });
  });
});
