import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { settings } from "../../database/quills/schema/auth";
import { tickets } from "../../database/quills/schema/tickets";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { posts } from "../../database/quills/schema/posts";
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
import { helpSeed } from "../content/public/seed.fixture";
import { scene, type Scene } from "../portal/feedback/seed.fixture";
import {
  callerOf,
  conversationOf,
  sharedRows,
  ticketOf,
} from "./customer/seed.fixture";

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

/** One embed preview request in workspace A, as customer A (portal) or with a widget token. */
async function embed(
  kind: string,
  id: string,
  as: { user?: string; token?: string; surface?: "portal" | "widget" } = {},
) {
  const env = contractEnv();
  const surface = as.surface ?? "portal";
  const res = await app.request(
    `/quills-public/${env.a}/${surface}/embed-preview?kind=${kind}&id=${encodeURIComponent(id)}`,
    {
      headers: {
        ...(as.user && { "x-test-user": as.user }),
        ...(as.token && { authorization: `Bearer ${as.token}` }),
      },
    },
  );
  return { status: res.status, body: await res.json() };
}
const unavailable = {
  unavailable: true,
  post: null,
  changelog: null,
  article: null,
  ticket: null,
};

/** Writes A's portal settings. */
const setPortal = (config: object) => {
  const env = contractEnv();
  return env.scoped(env.a, (db) =>
    db.update(settings).set({ portalConfig: JSON.stringify(config) }),
  );
};

/** IDs of the rows in A whose titles a customer must never read. */
async function hiddenIds(s: Scene) {
  const env = contractEnv();
  return env.scoped(env.a, async (db) => ({
    posts: (
      await db
        .select({ id: posts.id })
        .from(posts)
        .where(inArray(posts.title, s.a.hidden))
    ).map((row) => row.id as string),
    entries: (
      await db
        .select({ id: changelogEntries.id })
        .from(changelogEntries)
        .where(inArray(changelogEntries.title, s.a.hidden))
    ).map((row) => row.id as string),
  }));
}

describe.skipIf(!url)("Quills embed previews", () => {
  let s: Scene;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    s = await scene(contractEnv(), "portal");
  }, 120000);
  afterAll(() => stopContract());

  it("shows a visible post and changelog entry", async () => {
    const env = contractEnv();
    const post = await embed("post", s.a.postId, { user: env.customerA });
    expect(post.status).toBe(200);
    expect(post.body).toMatchObject({
      unavailable: false,
      post: { postId: s.a.postId, title: s.a.postTitle, boardName: "Public" },
      changelog: null,
    });
    expect(post.body.post.url).toMatch(
      new RegExp(`/portal/${env.a}/b/.+/posts/${s.a.postId}$`),
    );
    const entry = await embed("changelog", s.a.entryId, {
      user: env.customerA,
    });
    expect(entry.body).toMatchObject({
      unavailable: false,
      changelog: { entryId: s.a.entryId },
    });
  });

  it("answers unavailable for every row a customer may not open, and for workspace B", async () => {
    const env = contractEnv();
    const ids = await hiddenIds(s);
    expect(ids.posts.length).toBeGreaterThanOrEqual(5);
    expect(ids.entries.length).toBeGreaterThanOrEqual(3);
    const requests = [
      ...ids.posts.map((id) => ["post", id]),
      ...ids.entries.map((id) => ["changelog", id]),
      ["post", s.b.postId],
      ["changelog", s.b.entryId],
      ["post", "not-a-post-id"],
      ["ticket", s.a.postId],
    ];
    for (const [kind, id] of requests)
      for (const user of [env.customerA, undefined]) {
        const res = await embed(kind!, id!, { user });
        expect([kind, id, res.status, res.body]).toEqual([
          kind,
          id,
          200,
          unavailable,
        ]);
        for (const title of s.a.hidden)
          expect(JSON.stringify(res.body)).not.toContain(title);
      }
  });

  it("shows a ticket only to its requester", async () => {
    const env = contractEnv();
    const caller = await callerOf(env, "portal");
    const mine = await conversationOf(env, env.a, caller.principalId);
    const ticket = await ticketOf(
      env,
      env.a,
      caller.principalId,
      mine.conversationId,
    );
    const own = await embed("ticket", ticket.ticketId, { user: env.customerA });
    expect(own.body).toMatchObject({
      unavailable: false,
      ticket: {
        ticketId: ticket.ticketId,
        reference: `#${ticket.number}`,
        title: ticket.title,
        conversationId: mine.conversationId,
      },
    });
    const rows = await sharedRows(env);
    for (const [id, user] of [
      [ticket.ticketId, env.customerB],
      [ticket.ticketId, env.owner],
      [ticket.ticketId, undefined],
      [rows.otherTicket.ticketId, env.customerA],
      [rows.foreignTicket.ticketId, env.customerA],
    ])
      expect((await embed("ticket", id!, { user })).body).toEqual(unavailable);

    // The caller's own ticket that is internal, or deleted, is not a requester ticket.
    for (const change of [
      { type: "back_office" as const },
      { deletedAt: new Date() },
    ]) {
      const other = await conversationOf(env, env.a, caller.principalId);
      const hidden = await ticketOf(
        env,
        env.a,
        caller.principalId,
        other.conversationId,
      );
      await env.scoped(env.a, (db) =>
        db.update(tickets).set(change).where(eq(tickets.id, hidden.ticketId)),
      );
      const res = await embed("ticket", hidden.ticketId, {
        user: env.customerA,
      });
      expect(res.body).toEqual(unavailable);
      expect(JSON.stringify(res.body)).not.toContain(hidden.title);
    }

    // The portal's support switch off: the ticket card is unavailable, the route still answers.
    await setPortal({ enabled: true, support: { enabled: false } });
    try {
      expect(
        (await embed("ticket", ticket.ticketId, { user: env.customerA })).body,
      ).toEqual(unavailable);
    } finally {
      await setPortal({ enabled: true });
    }
  });

  it("shows a widget visitor's own ticket, and nothing to another visitor", async () => {
    const env = contractEnv();
    const caller = await callerOf(env, "widget");
    const mine = await conversationOf(env, env.a, caller.principalId);
    const ticket = await ticketOf(
      env,
      env.a,
      caller.principalId,
      mine.conversationId,
    );
    const own = await embed("ticket", ticket.ticketId, {
      token: caller.bearer,
      surface: "widget",
    });
    expect(own.body).toMatchObject({
      unavailable: false,
      ticket: { ticketId: ticket.ticketId, title: ticket.title },
    });
    const other = await env.widgetVisitor(env.a);
    const res = await embed("ticket", ticket.ticketId, {
      token: other.token,
      surface: "widget",
    });
    expect(res.body).toEqual(unavailable);
    expect(JSON.stringify(res.body)).not.toContain(ticket.title);
  });

  it("refuses an ID with a control character before any query", async () => {
    const env = contractEnv();
    for (const kind of ["article", "post"])
      expect(
        (await embed(kind, "x\u0000y", { user: env.customerA })).status,
      ).toBe(400);
  });

  it("shows a published article and hides the others", async () => {
    const env = contractEnv();
    const help = await helpSeed(env);
    const article = await embed("article", help.a.published.slug);
    expect(article.body).toMatchObject({
      unavailable: false,
      article: {
        slug: help.a.published.slug,
        title: `${help.a.label} published`,
      },
    });
    for (const slug of [
      ...help.a.hiddenPaths.filter((path) => !path.startsWith("/")),
      help.b.published.slug,
    ])
      expect((await embed("article", slug)).body).toEqual(unavailable);

    // The help center off: the article card is unavailable, the portal route still answers.
    await env.scoped(env.a, async (db) => {
      const [row] = await db
        .select({ flags: settings.featureFlags })
        .from(settings);
      await db.update(settings).set({
        featureFlags: JSON.stringify({
          ...JSON.parse(row?.flags ?? "{}"),
          helpCenter: false,
        }),
      });
    });
    expect((await embed("article", help.a.published.slug)).body).toEqual(
      unavailable,
    );
  });

  it("serves the widget with a widget session", async () => {
    const env = contractEnv();
    const visitor = await env.widgetVisitor(env.a);
    await env.scoped(env.a, (db) =>
      db
        .update(settings)
        .set({ widgetConfig: JSON.stringify({ enabled: true }) }),
    );
    const res = await embed("post", s.a.postId, {
      token: visitor.token,
      surface: "widget",
    });
    expect(res.body).toMatchObject({
      unavailable: false,
      post: { postId: s.a.postId },
    });
    expect(
      (await embed("post", s.a.postId, { surface: "widget" })).status,
    ).toBe(401);
  });

  it("answers 404 while the portal is off", async () => {
    const env = contractEnv();
    await env.scoped(env.a, (db) =>
      db
        .update(settings)
        .set({ portalConfig: JSON.stringify({ enabled: false }) }),
    );
    const res = await embed("post", s.a.postId, { user: env.customerA });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(s.a.postTitle);
  });
});
