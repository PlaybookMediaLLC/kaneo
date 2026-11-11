import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { settings } from "../../database/quills/schema/auth";
import {
  pageViews,
  visitorDevices,
  visitorStatsDaily,
} from "../../database/quills/schema/visitor-analytics";
import { refreshVisitorAnalytics } from "../../database/quills/visitor-rollup";
import * as kaneo from "../../database/schema";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import { enablePortal } from "../portal/seed.fixture";

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
const app = contractApp(quillsRouter, publicRouter);
const browser =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** One beacon from 198.51.100.7 to workspace A (or `workspace`). */
const beacon = (
  body: Record<string, unknown>,
  options: {
    headers?: Record<string, string>;
    text?: boolean;
    workspace?: string;
  } = {},
) =>
  app.request(`/quills-public/${options.workspace ?? contractEnv().a}/track`, {
    method: "POST",
    headers: {
      "content-type": options.text
        ? "text/plain;charset=UTF-8"
        : "application/json",
      "user-agent": browser,
      "x-kaneo-client-ip": "198.51.100.7",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
const viewsIn = (workspaceId: string, path: string) =>
  contractEnv().scoped(workspaceId, (db) =>
    db.select().from(pageViews).where(eq(pageViews.path, path)),
  );
const setWidget = (config: object) =>
  contractEnv().scoped(contractEnv().a, (db) =>
    db.update(settings).set({ widgetConfig: JSON.stringify(config) }),
  );

describe.skipIf(!url)("Visitor tracking beacon", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    const env = await startContract(pool, url!);
    await enablePortal(env, env.a);
    await enablePortal(env, env.b);
  }, 120000);
  afterAll(() => stopContract());

  it("stores derived fields only, and the rollup counts the view", async () => {
    const env = contractEnv();
    // A device that a widget session linked earlier (POST /widget/device).
    await env.scoped(env.a, (db) =>
      db.insert(visitorDevices).values({ deviceId: "device-1" }),
    );
    const res = await beacon(
      {
        url: "https://help.example/b/ideas?utm_source=newsletter&email=a@b.test",
        referrer: "https://news.example/today",
        surface: "portal",
        device: "device-1",
      },
      { headers: { "cf-ipcountry": "de" } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    const [row] = await viewsIn(env.a, "/b/ideas");
    expect(row).toMatchObject({
      siteOrigin: "https://help.example",
      surface: "portal",
      source: "newsletter",
      country: "DE",
      device: "mobile",
      browser: "Safari",
      os: "iOS",
      deviceId: "device-1",
      principalId: null,
    });
    expect(row!.visitorHash).toMatch(/^[0-9a-f]{64}$/);
    // Neither the raw IP, the User-Agent nor the query string is stored.
    const stored = JSON.stringify(row);
    for (const raw of [
      "198.51.100.7",
      "iPhone OS",
      "email=",
      "news.example/today",
    ])
      expect(stored).not.toContain(raw);
    const [device] = await env.scoped(env.a, (db) =>
      db
        .select()
        .from(visitorDevices)
        .where(eq(visitorDevices.deviceId, "device-1")),
    );
    expect(device?.lastCountry).toBe("DE");
    // An unknown device ID is stored with the view only: the anonymous beacon creates no device row.
    await beacon({
      url: "https://help.example/unknown-device",
      surface: "portal",
      device: "device-unknown",
    });
    expect((await viewsIn(env.a, "/unknown-device"))[0]?.deviceId).toBe(
      "device-unknown",
    );
    expect(
      await env.scoped(env.a, (db) =>
        db
          .select()
          .from(visitorDevices)
          .where(eq(visitorDevices.deviceId, "device-unknown")),
      ),
    ).toEqual([]);

    await withQuillsSystemWorkspace(env.a, (db) => refreshVisitorAnalytics(db));
    const [daily] = await env.scoped(env.a, (db) =>
      db
        .select()
        .from(visitorStatsDaily)
        .where(eq(visitorStatsDaily.surface, "portal")),
    );
    // Two views by the same visitor (same IP and User-Agent, same day): one unique visitor.
    expect(daily).toMatchObject({ pageviews: 2, uniqueVisitors: 1 });
  });

  it("hashes a visitor the same within a day and workspace, differently across workspaces", async () => {
    const env = contractEnv();
    const page = { url: "https://help.example/same", surface: "portal" };
    await beacon(page);
    await beacon(page, { text: true });
    await beacon(page, { workspace: env.b });
    const [first, second] = await viewsIn(env.a, "/same");
    const [other] = await viewsIn(env.b, "/same");
    expect(second, "a text/plain body is read as JSON").toBeDefined();
    expect(first!.visitorHash).toBe(second!.visitorHash);
    expect(other!.visitorHash).not.toBe(first!.visitorHash);
  });

  it("stores nothing for an opt-out, a bot, a non-http URL or a widget with analytics off", async () => {
    const env = contractEnv();
    const send = (
      path: string,
      options: Parameters<typeof beacon>[1] = {},
      url = `https://help.example${path}`,
    ) => beacon({ url, surface: "portal" }, options);
    // The same answer as a stored view, so a caller cannot tell why nothing was stored.
    const answers = [
      await send("/dnt", { headers: { dnt: "1" } }),
      await send("/gpc", { headers: { "sec-gpc": "1" } }),
      await send("/bot", { headers: { "user-agent": "Googlebot/2.1" } }),
      await send("/script", {}, "javascript:alert(1)"),
    ];
    for (const res of answers)
      expect([res.status, await res.json()]).toEqual([200, {}]);
    for (const path of ["/dnt", "/gpc", "/bot", "/script"])
      expect(await viewsIn(env.a, path)).toEqual([]);

    await setWidget({ enabled: true, visitorAnalytics: false });
    expect(
      (await beacon({ url: "https://host.example/off", surface: "widget" }))
        .status,
    ).toBe(200);
    expect(await viewsIn(env.a, "/off")).toEqual([]);
    // Device tracking off: the view counts, the device ID is dropped.
    await setWidget({ enabled: true, visitorDeviceTracking: false });
    await beacon({
      url: "https://host.example/no-device",
      surface: "widget",
      device: "device-2",
    });
    expect((await viewsIn(env.a, "/no-device"))[0]?.deviceId).toBeNull();
  });

  it("answers 404 while the surface is off and stores nothing", async () => {
    const env = contractEnv();
    await setWidget({ enabled: false });
    const res = await beacon({
      url: "https://host.example/closed",
      surface: "widget",
    });
    expect(res.status).toBe(404);
    expect(await viewsIn(env.a, "/closed")).toEqual([]);
  });

  it("stores nothing on a day with no page-view partition, and never creates one", async () => {
    const env = contractEnv();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-06-01T12:00:00Z"));
    try {
      const res = await beacon({
        url: "https://help.example/future",
        surface: "portal",
      });
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    expect(await viewsIn(env.a, "/future")).toEqual([]);
    const { rows } = await pool.query(
      "SELECT to_regclass('quills.page_views_20990601') IS NULL AS missing",
    );
    expect(rows[0].missing).toBe(true);
  });
});
