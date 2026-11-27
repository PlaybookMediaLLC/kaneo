import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Pool } from "pg";
import { settings } from "../../database/quills/schema/auth";
import { conversationMessages } from "../../database/quills/schema/conversation";
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
import { world } from "../portal/feedback/seed.fixture";
import { enableWidget, signIdentity } from "./seed.fixture";
import { widgetHost } from "./host";

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

describe("widget host page and bundles", () => {
  const dist = mkdtempSync(join(tmpdir(), "widget-dist-"));
  writeFileSync(join(dist, "host.js"), "console.log('host')");
  writeFileSync(join(dist, "host.css"), "body{}");
  writeFileSync(join(dist, "browser.js"), "window.QuillsBundle=1");
  const app = new Hono().route(
    "/quills-public",
    widgetHost(() => dist),
  );
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it("serves the iframe page with a strict policy that any web origin may frame", async () => {
    const res = await app.request("/quills-public/acme/widget");
    expect(res.status).toBe(200);
    const policy = res.headers.get("content-security-policy")!;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors http: https:");
    expect(policy).not.toContain("unsafe");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const html = await res.text();
    expect(html).toMatch(/src="widget\/host\.js\?v=[0-9a-f]{16}"/);
    expect(html).toMatch(/href="widget\/host\.css\?v=[0-9a-f]{16}"/);
    // The page carries nothing from the request: the browser reads the workspace from its URL.
    expect(html).not.toContain("acme");
  });

  it("caches a bundle for a year only under its current content version", async () => {
    const html = await (await app.request("/quills-public/acme/widget")).text();
    const version = /host\.js\?v=([0-9a-f]+)/.exec(html)![1];
    const pinned = await app.request(
      `/quills-public/acme/widget/host.js?v=${version}`,
    );
    expect(pinned.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(pinned.headers.get("content-type")).toContain("text/javascript");
    expect(await pinned.text()).toBe("console.log('host')");
    const stale = await app.request("/quills-public/acme/widget/host.js?v=old");
    expect(stale.headers.get("cache-control")).toBe("public, max-age=300");
    const sdk = await app.request("/quills-public/acme/widget/sdk.js");
    expect(sdk.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await sdk.text()).toBe("window.QuillsBundle=1");
    expect(
      (await app.request("/quills-public/acme/widget/host.css")).headers.get(
        "content-type",
      ),
    ).toContain("text/css");
  });

  it("answers 304 Not Modified when If-None-Match matches the widget ETag", async () => {
    const page = await app.request("/quills-public/acme/widget");
    const pageEtag = page.headers.get("etag");
    expect(pageEtag).toBeTruthy();
    const page304 = await app.request("/quills-public/acme/widget", {
      headers: { "If-None-Match": pageEtag! },
    });
    expect(page304.status).toBe(304);

    const sdk = await app.request("/quills-public/acme/widget/sdk.js");
    const sdkEtag = sdk.headers.get("etag");
    expect(sdkEtag).toBeTruthy();
    const sdk304 = await app.request("/quills-public/acme/widget/sdk.js", {
      headers: { "If-None-Match": sdkEtag! },
    });
    expect(sdk304.status).toBe(304);
  });

  it("answers 503 while the widget is not built", async () => {
    const empty = new Hono().route(
      "/quills-public",
      widgetHost(() => null),
    );
    for (const path of ["", "/host.js", "/host.css", "/sdk.js"])
      expect(
        (await empty.request(`/quills-public/acme/widget${path}`)).status,
      ).toBe(503);
  });

  it("serves a widget that was built after the API started", async () => {
    let built: string | null = null;
    const late = new Hono().route(
      "/quills-public",
      widgetHost(() => built),
    );
    expect((await late.request("/quills-public/acme/widget")).status).toBe(503);
    built = dist;
    expect((await late.request("/quills-public/acme/widget")).status).toBe(200);
  });
});

// The browser adapter's request code, run against the real routes and PostgreSQL. It is loaded
// by path: packages/widget is outside this package's TypeScript root.
const adapter = (file: string) =>
  import(
    /* @vite-ignore */ fileURLToPath(
      new URL(
        `../../../../../packages/widget/src/adapter/${file}.ts`,
        import.meta.url,
      ),
    )
  );

describe.skipIf(!url)("widget adapter against the real API", () => {
  const app = contractApp(quillsRouter, publicRouter);
  let secret: string;
  let postId: string;
  let postTitle: string;
  let entryId: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    const env = contractEnv();
    secret = await enableWidget(env, env.a);
    await env.scoped(env.a, (db) =>
      db.update(settings).set({
        widgetConfig: JSON.stringify({
          enabled: true,
          tabs: {
            feedback: true,
            changelog: true,
            help: false,
            messenger: true,
            tickets: false,
            home: true,
          },
        }),
      }),
    );
    const seeded = await world(env, env.a);
    postId = seeded.postId;
    postTitle = seeded.postTitle;
    entryId = seeded.entryId;
  }, 120000);
  afterAll(() => stopContract());

  it("lets any origin read the public config.json that the SDK fetches from the host page", async () => {
    const res = await app.request(
      `/quills-public/${contractEnv().a}/widget/config.json`,
      {
        headers: { origin: "https://host.example" },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await res.json()).config.tabs.messenger).toBe(true);
  });

  it("identifies, loads, votes, comments, posts and messages with replay-safe keys", async () => {
    const env = contractEnv();
    const { createApi } = await adapter("api");
    const { loadSnapshot, loadPost, loadConversations } = await adapter("load");
    const { writes } = await adapter("writes");
    const api = createApi(
      `/quills-public/${env.a}`,
      (path: string, init: RequestInit) => app.request(path, init),
    );
    const sub = env.id("visitor");
    const { token, user } = await api.identify(
      signIdentity(
        {
          sub,
          email: `${sub}@example.test`,
          exp: Math.floor(Date.now() / 1000) + 300,
        },
        secret,
      ),
    );
    expect(user.email).toBe(`${sub}@example.test`);
    api.setToken(token);
    const send = writes(api);

    const snapshot = await loadSnapshot(api, {
      surfaces: {
        feedback: true,
        changelog: true,
        help: false,
        messenger: true,
      },
    });
    expect(
      snapshot.feedback.map((post: { title: string }) => post.title),
    ).toContain(postTitle);
    expect(snapshot.updates.map((entry: { id: string }) => entry.id)).toContain(
      entryId,
    );
    expect(snapshot.conversations).toEqual([]);

    const vote = await send.vote(postId, true);
    expect(vote.voted).toBe(true);
    expect((await send.vote(postId, true)).voteCount).toBe(vote.voteCount);

    const key = env.id("comment").replace(/[^A-Za-z0-9_-]/g, "");
    const comment = await send.comment(postId, "Hello from the widget", key);
    expect((await send.comment(postId, "Hello from the widget", key)).id).toBe(
      comment.id,
    );
    const liked = await send.voteComment(comment.id, true);
    expect(liked.reactions).toContainEqual({
      emoji: "👍",
      count: 1,
      reacted: true,
    });
    const detail = await loadPost(api, postId);
    expect(
      detail.comments.filter(
        (item: { body: string }) => item.body === "Hello from the widget",
      ),
    ).toEqual([
      expect.objectContaining({ id: comment.id, votes: 1, voted: true }),
    ]);

    const created = await send.createPost(
      "A widget idea\nWith detail",
      `${key}post`,
    );
    expect(created).toMatchObject({ title: "A widget idea", stage: "open" });

    const page = { pageUrl: "https://host.example/pricing", browser: "Chrome" };
    const started = await send.startConversation(
      "I need help",
      `${key}conv`,
      undefined,
      page,
    );
    const again = await send.startConversation("I need help", `${key}conv`);
    expect(again.message.id).toBe(started.message.id);
    await send.reply(
      started.conversation.id,
      "More detail",
      `${key}reply`,
      undefined,
      { ...page, pageUrl: "https://host.example/checkout" },
    );
    const threads = await loadConversations(api);
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m: { body: string }) => m.body)).toEqual([
      "I need help",
      "More detail",
    ]);
    // Each message keeps the page it was sent from, for the team; the visitor never reads it back.
    expect(JSON.stringify(threads)).not.toContain("host.example");
    const stored = await env.scoped(env.a, (db) =>
      db
        .select({ metadata: conversationMessages.metadata })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, started.conversation.id))
        .orderBy(conversationMessages.createdAt),
    );
    expect(stored.map((row) => row.metadata?.widgetMetadata)).toEqual([
      page,
      { ...page, pageUrl: "https://host.example/checkout" },
    ]);
    const tooMany = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]),
    );
    await expect(
      send.startConversation("Too much", `${key}big`, undefined, tooMany),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await send.markRead(started.conversation.id, threads[0].messages[1].id),
    ).toMatchObject({ unreadCount: 0 });
    expect(await send.unread()).toEqual({ unreadCount: 0 });

    api.setToken("not-a-session");
    await expect(
      loadSnapshot(api, {
        surfaces: {
          feedback: true,
          changelog: false,
          help: false,
          messenger: false,
        },
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("shows a visitor message's page context to the workspace's teammates only", async () => {
    const env = contractEnv();
    const { createApi } = await adapter("api");
    const { writes } = await adapter("writes");
    const api = createApi(
      `/quills-public/${env.a}`,
      (path: string, init: RequestInit) => app.request(path, init),
    );
    const sub = env.id("context");
    const { token } = await api.identify(
      signIdentity(
        {
          sub,
          email: `${sub}@example.test`,
          exp: Math.floor(Date.now() / 1000) + 300,
        },
        secret,
      ),
    );
    api.setToken(token);
    const page = {
      pageUrl: "https://host.example/billing",
      browser: "Firefox 140 on Linux",
    };
    const { conversation, message } = await writes(api).startConversation(
      "Where is my invoice?",
      `${sub}conv`.replace(/[^A-Za-z0-9_-]/g, ""),
      undefined,
      page,
    );
    const teammate = (workspace: string, user: string) =>
      app.request(
        `/quills/${workspace}/conversations/${conversation.id}/messages`,
        { headers: { "x-test-user": user } },
      );
    const own = await teammate(env.a, env.owner);
    expect(own.status).toBe(200);
    const items = (await own.json()).items as {
      id: string;
      widgetMetadata: unknown;
    }[];
    expect(
      items.find((item) => item.id === message.id)?.widgetMetadata,
    ).toEqual(page);
    // Workspace B's owner reaches it neither through B nor through A (non-disclosing 404s), and B's
    // scope has no such row.
    const inOwnWorkspace = await app.request(`/quills/${env.b}/conversations`, {
      headers: { "x-test-user": env.outsider },
    });
    expect(inOwnWorkspace.status).toBe(200);
    expect((await teammate(env.b, env.outsider)).status).toBe(404);
    expect((await teammate(env.a, env.outsider)).status).toBe(404);
    const inB = await env.scoped(env.b, (db) =>
      db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, message.id)),
    );
    expect(inB).toEqual([]);
  });

  it("creates the secret of a widget that was turned on without one, once for concurrent visitors", async () => {
    const env = contractEnv();
    const { createApi } = await adapter("api");
    const { loadConversations } = await adapter("load");
    const secretOf = async () =>
      (
        await env.scoped(env.a, (db) =>
          db.select({ secret: settings.widgetSecret }).from(settings),
        )
      )[0]!.secret;
    const before = await secretOf();
    await env.scoped(env.a, (db) =>
      db.update(settings).set({ widgetSecret: null }),
    );
    try {
      const apis = [0, 1].map(() =>
        createApi(
          `/quills-public/${env.a}`,
          (path: string, init: RequestInit) => app.request(path, init),
        ),
      );
      const tokens = await Promise.all(apis.map((api) => api.mintAnonymous()));
      expect(await secretOf()).toMatch(/^wgt_[0-9a-f]{64}$/);
      // Both sessions are bound to the one secret that was kept.
      for (const [i, api] of apis.entries()) {
        api.setToken(tokens[i]);
        expect(await loadConversations(api)).toEqual([]);
      }
    } finally {
      await env.scoped(env.a, (db) =>
        db.update(settings).set({ widgetSecret: before }),
      );
    }
  });

  it("starts an anonymous session that reads but cannot read another visitor's thread", async () => {
    const env = contractEnv();
    const { createApi } = await adapter("api");
    const { loadConversations } = await adapter("load");
    const api = createApi(
      `/quills-public/${env.a}`,
      (path: string, init: RequestInit) => app.request(path, init),
    );
    api.setToken(await api.mintAnonymous());
    expect(await loadConversations(api)).toEqual([]);
    const other = createApi(
      `/quills-public/${env.b}`,
      (path: string, init: RequestInit) => app.request(path, init),
    );
    // B turned the widget off: no session there.
    await env.scoped(env.b, (db) =>
      db
        .update(settings)
        .set({ widgetConfig: JSON.stringify({ enabled: false }) }),
    );
    await expect(other.mintAnonymous()).rejects.toMatchObject({ status: 404 });
  });

  it("serves a workspace that never set the widget: it is on by default", async () => {
    const env = contractEnv();
    const { createApi } = await adapter("api");
    const { loadConversations } = await adapter("load");
    await env.scoped(env.b, (db) =>
      db.update(settings).set({ widgetConfig: null, widgetSecret: null }),
    );
    const config = await app.request(
      `/quills-public/${env.b}/widget/config.json`,
    );
    expect((await config.json()).enabled).toBe(true);
    const api = createApi(
      `/quills-public/${env.b}`,
      (path: string, init: RequestInit) => app.request(path, init),
    );
    api.setToken(await api.mintAnonymous());
    expect(await loadConversations(api)).toEqual([]);
  });
});
