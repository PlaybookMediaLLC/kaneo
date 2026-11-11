import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
import { Pool } from "pg";
import { settings } from "../../database/quills/schema/auth";
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
import { enableMessenger } from "./customer/seed.fixture";
import { fetchHtmlPage } from "./link-fetch";
import { parsePreview } from "./link-preview";

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

const PAGE = `<!doctype html><html><head>
<title>Fallback &amp; title</title>
<meta property="og:title" content="Release &quot;7&quot;&#x21;">
<meta name='description' content='The plain description'>
<meta property=og:site_name content=Example>
</head><body>secret body text</body></html>`;

/** A local web server: every request is counted, nothing leaves the machine. */
let stub: Server;
let base = "";
const hits: string[] = [];
const routes: Record<
  string,
  (
    send: (
      status: number,
      headers: Record<string, string>,
      body?: string | Buffer,
    ) => void,
  ) => void
> = {
  "/page": (send) =>
    send(200, { "content-type": "text/html; charset=utf-8" }, PAGE),
  "/to-metadata": (send) =>
    send(302, { location: "http://169.254.169.254/latest/meta-data/" }),
  "/to-loopback": (send) => send(302, { location: `${base}/page` }),
  "/to-private": (send) => send(301, { location: "http://10.1.2.3/" }),
  "/to-ipv6-loopback": (send) => send(307, { location: "http://[::1]/" }),
  "/loop": (send) => send(302, { location: "/loop" }),
  "/json": (send) => send(200, { "content-type": "application/json" }, "{}"),
  "/latin1": (send) =>
    send(
      200,
      { "content-type": "text/html; charset=windows-1252" },
      Buffer.from([
        ...Buffer.from("<title>Caf"),
        0xe9,
        ...Buffer.from("</title>"),
      ]),
    ),
  "/error": (send) =>
    send(500, { "content-type": "text/html" }, "Internal secret stack trace"),
  "/big": (send) =>
    send(
      200,
      { "content-type": "text/html" },
      `<title>Big</title>${"x".repeat(2 * 1024 * 1024)}`,
    ),
};

/** A public-looking address served by the local stub, so the guard's redirect checks run. */
const viaStub = (async (input: string, init?: RequestInit) =>
  fetch(`${base}${new URL(input).pathname}`, {
    ...init,
    redirect: "manual",
  })) as unknown as NonNullable<
  Parameters<typeof fetchHtmlPage>[1]
>["baseFetch"];
const PUBLIC = "http://93.184.216.34";

describe("link preview parser", () => {
  it("reads OpenGraph first, then the other tags, and decodes entities once", () => {
    expect(parsePreview(PAGE, "https://example.com/a")).toEqual({
      url: "https://example.com/a",
      title: 'Release "7"!',
      description: "The plain description",
      siteName: "Example",
    });
    expect(
      parsePreview(
        "<title>Only &amp;lt; a\u0000 title</title><meta name=description>",
        "u",
      ),
    ).toEqual({
      url: "u",
      title: "Only &lt; a title",
      description: null,
      siteName: null,
    });
    expect(parsePreview("<html><body>No head</body></html>", "u")).toBeNull();
    expect(
      parsePreview(
        '<meta property="og:title" content=""><title>Fallback</title>',
        "u",
      )?.title,
    ).toBe("Fallback");
    expect(
      parsePreview(`<title>${"t".repeat(5000)}</title>`, "u")?.title,
    ).toHaveLength(200);
  });

  it("parses hostile pages in linear time", () => {
    const hostile = [
      `<meta ${"a=".repeat(150_000)}`,
      "<meta ".repeat(60_000),
      `<meta ${" ".repeat(300_000)}>`,
      `<meta content='${"x".repeat(300_000)}`,
      "<title>".repeat(60_000),
      `<meta name=x content="${"&#1".repeat(100_000)}">`,
      "<meta name=a content=b>".repeat(30_000),
      `<head${"<".repeat(300_000)}`,
      `<meta ${"a=".repeat(90_000)}>`,
      `<meta content="${"x".repeat(150_000)}">`,
      `<meta ${"= ".repeat(90_000)}>`,
    ];
    for (const page of hostile) {
      const started = performance.now();
      parsePreview(page, "u");
      expect(performance.now() - started).toBeLessThan(250);
    }
  });
});

describe("link fetch guard", () => {
  beforeAll(async () => {
    stub = createServer((req, res) => {
      hits.push(req.url ?? "");
      const route = routes[new URL(req.url ?? "/", "http://stub").pathname];
      if (!route) return res.writeHead(404).end();
      route((status, headers, body) =>
        res.writeHead(status, headers).end(body),
      );
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => stub.close(() => resolve())));
  afterEach(() => {
    vi.unstubAllEnvs();
    hits.length = 0;
  });

  it("imports only the guard and its address rules", () => {
    const source = readFileSync(
      new URL("./link-fetch.ts", import.meta.url),
      "utf8",
    );
    expect(
      [...source.matchAll(/from "([^"]+)"|import\("([^"]+)"\)/g)].map(
        (match) => match[1] ?? match[2],
      ),
    ).toEqual([
      "../../import/guarded-fetch",
      "../../utils/assert-public-destination",
    ]);
    // Not a route module either: framework/boundaries.test.ts would scan a route module's imports.
    expect(source).not.toMatch(
      /define-route|apiRouter|withQuills|process\.env/,
    );
  });

  it("refuses private, loopback, link-local and metadata addresses before connecting", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    // Through the real socket path: the local stub never sees a request.
    for (const target of [
      `${base}/page`,
      `http://localhost:${new URL(base).port}/page`,
    ])
      expect([target, await fetchHtmlPage(target)]).toEqual([target, null]);
    expect(hits).toEqual([]);
    // A spy in place of the connection: the guard refuses before it is ever called.
    const spy = vi.fn(viaStub);
    for (const target of [
      "http://169.254.169.254/latest/meta-data/",
      "http://10.1.2.3/",
      "http://192.168.1.1/",
      "http://100.64.0.1/",
      "http://0x7f.1/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/",
    ])
      expect([
        target,
        await fetchHtmlPage(target, { baseFetch: spy as never }),
      ]).toEqual([target, null]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never reaches a private address for a customer, also when the instance allows it", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    expect(await fetchHtmlPage(`${base}/page`, { strict: true })).toBeNull();
    expect(hits).toEqual([]);
    // A teammate follows the instance switch, as imports and webhooks do.
    expect((await fetchHtmlPage(`${base}/page`))?.html).toBe(PAGE);
  });

  it("decodes the charset that the content type names", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    const page = await fetchHtmlPage(`${base}/latin1`);
    expect(parsePreview(page!.html, page!.url)?.title).toBe("Caf\u00e9");
  });

  it("refuses a redirect to a private, loopback or metadata address after one hop", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    for (const path of [
      "/to-metadata",
      "/to-loopback",
      "/to-private",
      "/to-ipv6-loopback",
    ]) {
      hits.length = 0;
      expect(
        await fetchHtmlPage(`${PUBLIC}${path}`, { baseFetch: viaStub }),
      ).toBeNull();
      expect(hits).toEqual([path]);
    }
  });

  it("bounds redirects, size, type and status, and returns no error text", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    expect(
      await fetchHtmlPage(`${PUBLIC}/loop`, { baseFetch: viaStub }),
    ).toBeNull();
    expect(hits).toHaveLength(4);
    expect(
      await fetchHtmlPage(`${PUBLIC}/json`, { baseFetch: viaStub }),
    ).toBeNull();
    expect(
      await fetchHtmlPage(`${PUBLIC}/error`, { baseFetch: viaStub }),
    ).toBeNull();
    const big = await fetchHtmlPage(`${PUBLIC}/big`, { baseFetch: viaStub });
    expect(big?.html.length).toBe(512 * 1024);
    expect(
      (await fetchHtmlPage(`${PUBLIC}/page`, { baseFetch: viaStub }))?.html,
    ).toBe(PAGE);
  });

  it("answers within 5 seconds also when a step ignores the abort, and caps previews at 2", async () => {
    // A stuck step, like a DNS lookup: it takes no signal and does not end at the deadline.
    const release: ((response: Response) => void)[] = [];
    const stuck = (() =>
      new Promise<Response>((resolve) => release.push(resolve))) as never;
    const started = Date.now();
    const first = fetchHtmlPage(`${PUBLIC}/one`, { baseFetch: stuck });
    const second = fetchHtmlPage(`${PUBLIC}/two`, { baseFetch: stuck });
    // Two previews hold their slots: a third answers null at once, with no request.
    const spy = vi.fn(viaStub);
    expect(
      await fetchHtmlPage(`${PUBLIC}/page`, { baseFetch: spy as never }),
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(await Promise.all([first, second])).toEqual([null, null]);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4900);
    expect(elapsed).toBeLessThan(6000);
    // The slots stay taken until the stuck steps end.
    expect(
      await fetchHtmlPage(`${PUBLIC}/page`, { baseFetch: spy as never }),
    ).toBeNull();
    for (const resolve of release) resolve(new Response("", { status: 500 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      (await fetchHtmlPage(`${PUBLIC}/page`, { baseFetch: viaStub }))?.html,
    ).toBe(PAGE);
  }, 10_000);
});

describe.skipIf(!url)("Quills link preview routes", () => {
  const send = async (path: string, headers: Record<string, string> = {}) => {
    const res = await app.request(path, { headers });
    return { status: res.status, body: await res.json() };
  };
  const preview = (workspace: string, user: string, target: string) =>
    send(
      `/quills/${workspace}/support/link-preview?url=${encodeURIComponent(target)}`,
      { "x-test-user": user },
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    stub = createServer((req, res) => {
      hits.push(req.url ?? "");
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(req.url?.includes("error") ? "Internal secret" : PAGE);
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  }, 120000);
  afterAll(async () => {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await stopContract();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    hits.length = 0;
  });

  it("answers null for a loopback page, without a request to it", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const env = contractEnv();
    expect(await preview(env.a, env.owner, `${base}/page?refused`)).toEqual({
      status: 200,
      body: { preview: null },
    });
    expect(hits).toEqual([]);
  });

  it("fetches and parses an allowed page, writes nothing, and returns no error text", async () => {
    // The operator switch that allows private destinations lets the local stub play a public site.
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    const env = contractEnv();
    const kvRows = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM quills.kv_store WHERE workspace_id=$1",
          [env.a],
        )
      ).rows[0].n as number;
    const before = await kvRows();
    const res = await preview(env.a, env.owner, `${base}/page?allowed`);
    expect(res.status).toBe(200);
    expect(res.body.preview).toEqual({
      url: `${base}/page?allowed`,
      title: 'Release "7"!',
      description: "The plain description",
      siteName: "Example",
    });
    expect(hits).toEqual(["/page?allowed"]);
    expect(await kvRows()).toBe(before);
    const broken = await preview(env.a, env.owner, `${base}/error`);
    expect(broken).toEqual({ status: 200, body: { preview: null } });
    expect(JSON.stringify(broken.body)).not.toContain("secret");
  });

  it("serves the widget composer only while its messenger is on, and never a private page", async () => {
    // The instance allows private destinations; a customer route still refuses them.
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    const env = contractEnv();
    const visitor = await env.widgetVisitor(env.a);
    const path = `/quills-public/${env.a}/widget/link-preview?url=${encodeURIComponent(`${base}/page?widget`)}`;
    const auth = { authorization: `Bearer ${visitor.token}` };
    await enableMessenger(env, env.a);
    expect(await send(path, auth)).toEqual({
      status: 200,
      body: { preview: null },
    });
    expect((await send(path)).status).toBe(401);
    await env.scoped(env.a, (db) =>
      db.update(settings).set({
        widgetConfig: JSON.stringify({
          enabled: true,
          tabs: { messenger: false, tickets: true },
        }),
      }),
    );
    expect((await send(path, auth)).status).toBe(404);
    expect(hits).toEqual([]);
  });

  it("serves the portal composer only while its support pages are on", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");
    const env = contractEnv();
    const path = `/quills-public/${env.a}/support/link-preview?url=${encodeURIComponent(`${base}/page?portal`)}`;
    const portal = (config: object) =>
      env.scoped(env.a, (db) =>
        db.update(settings).set({ portalConfig: JSON.stringify(config) }),
      );
    await portal({ enabled: true });
    expect(await send(path, { "x-test-user": env.customerA })).toEqual({
      status: 200,
      body: { preview: null },
    });
    await portal({ enabled: true, support: { enabled: false } });
    expect((await send(path, { "x-test-user": env.customerA })).status).toBe(
      404,
    );
    expect(hits).toEqual([]);
  });
});
