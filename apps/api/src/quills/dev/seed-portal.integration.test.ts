import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../database/schema";
import { withQuillsWorkspace } from "../../database/quills/client";
import { statusIncidentComponents } from "../../database/quills/schema/status";
import { settings } from "../../database/quills/schema/auth";
import {
  posts,
  postComments,
  postVotes,
} from "../../database/quills/schema/posts";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../database/quills/schema/kb";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { kvStore } from "../../database/quills/schema/kv";
import { auditLog } from "../../database/quills/schema/audit-log";
import { events } from "../../database/quills/schema/events";
import * as changes from "../events";
import { seedPortalShowcase } from "./showcase";
import * as showcase from "./showcase";
import quillsRouter from "../index";
import publicRouter from "../public";
import {
  contractApp,
  contractSession,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import { seedPortal } from "./seed-portal";

let pool: Pool;
vi.mock("../../database/index", () => ({
  getDatabasePool: () => pool,
  getDatabase: () => drizzle(pool, { schema }),
  get schema() {
    return schema;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema });
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

describe.skipIf(!url)("portal demo seed integration", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("NODE_ENV", "test");
  }, 120000);
  afterAll(async () => {
    const db = drizzle(pool, { schema });
    const [workspace] = await db
      .select({ metadata: schema.workspaceTable.metadata })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, "quills_portal_demo"));
    if (
      workspace &&
      JSON.parse(workspace.metadata ?? "{}").fixture === "quills-portal-demo-v1"
    ) {
      await db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, "quills_portal_demo"));
      await db
        .delete(schema.userTable)
        .where(eq(schema.userTable.id, "quills_portal_demo_user"));
    }
    vi.unstubAllEnvs();
    await stopContract();
  }, 60000);

  it("rolls back the showcase and its receipt when recording the import fails", async () => {
    const record = changes.recordQuillsChange;
    const spy = vi
      .spyOn(changes, "recordQuillsChange")
      .mockImplementation(async (...args) => {
        const eventId = await record(...args);
        if (args[2].type === "workspace.imported")
          throw new Error("injected showcase failure");
        return eventId;
      });
    try {
      await expect(seedPortal()).rejects.toThrow("injected showcase failure");
    } finally {
      spy.mockRestore();
    }
    await withQuillsWorkspace(
      { workspaceId: "quills_portal_demo", userId: "quills_portal_demo_user" },
      async (db) => {
        expect(await db.select({ id: posts.id }).from(posts)).toEqual([]);
        expect(await db.select({ key: kvStore.key }).from(kvStore)).toEqual([]);
        expect(
          await db
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(eq(auditLog.eventType, "workspace.imported")),
        ).toEqual([]);
        expect(
          await db
            .select({ id: events.eventId })
            .from(events)
            .where(eq(events.type, "workspace.imported")),
        ).toEqual([]);
      },
    );
  }, 30000);

  it("seeds a visible incident idempotently with a complete brand color pair", async () => {
    const skipShowcase = vi
      .spyOn(showcase, "seedPortalShowcase")
      .mockResolvedValue();
    let identity: Awaited<ReturnType<typeof seedPortal>>;
    try {
      identity = await seedPortal();
      await seedPortal();
    } finally {
      skipShowcase.mockRestore();
    }
    const response = await app.request(
      `/quills-public/${identity.workspaceId}/status`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json();
    expect(body.activeIncidents).toHaveLength(1);
    expect(body.activeIncidents[0].title).toBe("Portal demo incident");
    expect(body.activeIncidents[0].affectedComponents).toHaveLength(1);
    expect(body.activeIncidents[0].affectedComponents[0].name).toBe("API");
    expect(body.topLevelStatus).toBe("degraded_performance");
    await withQuillsWorkspace(identity, async (db) => {
      expect(await db.select().from(statusIncidentComponents)).toHaveLength(1);
      const [row] = await db
        .select({ branding: settings.brandingConfig })
        .from(settings);
      expect(JSON.parse(row!.branding!).light).toMatchObject({
        primary: "oklch(0.55 0.2 260)",
        primaryForeground: "oklch(1 0 0)",
      });
    });
  }, 30000);

  it("keeps real counts, paginates discussion, and preserves edits on reseed", async () => {
    const identity = {
      workspaceId: "quills_portal_demo",
      userId: "quills_portal_demo_user",
    };
    await withQuillsWorkspace(identity, async (db) => {
      expect(await db.select().from(kvStore)).toEqual([]);
      expect(await db.select({ count: count() }).from(posts)).toEqual([
        { count: 1 },
      ]);
    });
    await Promise.all([
      withQuillsWorkspace(identity, seedPortalShowcase),
      withQuillsWorkspace(identity, seedPortalShowcase),
    ]);
    let featuredId = "";
    await withQuillsWorkspace(identity, async (db) => {
      expect(await db.select().from(kvStore)).toHaveLength(1);
      expect(
        await db
          .select({ count: count() })
          .from(events)
          .where(eq(events.type, "workspace.imported")),
      ).toEqual([{ count: 1 }]);
      expect(await db.select({ count: count() }).from(posts)).toEqual([
        { count: 121 },
      ]);
      expect(
        await db.select({ count: count() }).from(helpCenterArticles),
      ).toEqual([{ count: 49 }]);
      expect(
        await db.select({ count: count() }).from(helpCenterCategories),
      ).toEqual([{ count: 8 }]);
      expect(
        await db.select({ count: count() }).from(changelogEntries),
      ).toEqual([{ count: 9 }]);
      const [featured] = await db
        .select()
        .from(posts)
        .where(eq(posts.title, "Linear integration"));
      featuredId = featured!.id;
      expect(featured!.voteCount).toBe(144);
      expect(featured!.commentCount).toBe(128);
      expect(
        await db
          .select({ count: count() })
          .from(postVotes)
          .where(eq(postVotes.postId, featured!.id)),
      ).toEqual([{ count: 144 }]);
      expect(
        await db
          .select({ count: count() })
          .from(postComments)
          .where(eq(postComments.postId, featured!.id)),
      ).toEqual([{ count: 128 }]);
      const mismatch = await db.execute(
        sql`select id from quills.posts p where vote_count <> (select count(*) from quills.post_votes v where v.post_id = p.id) or comment_count <> (select count(*) from quills.post_comments c where c.post_id = p.id)`,
      );
      expect(mismatch.rows).toEqual([]);
      await db
        .update(posts)
        .set({ content: "An edit made while exploring the demo." })
        .where(eq(posts.id, featured!.id));
    });
    await Promise.all([seedPortal(), seedPortal()]);
    const first = await app.request(
      `/quills-public/${identity.workspaceId}/portal/posts/${featuredId}/comments?limit=100&offset=0`,
    );
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.items).toHaveLength(100);
    const second = await app.request(
      `/quills-public/${identity.workspaceId}/portal/posts/${featuredId}/comments?limit=100&offset=100`,
    );
    const secondPage = await second.json();
    expect(second.status).toBe(200);
    expect(secondPage.items).toHaveLength(28);
    expect(
      new Set([...firstPage.items, ...secondPage.items].map((item) => item.id))
        .size,
    ).toBe(128);
    await withQuillsWorkspace(identity, async (db) => {
      const [featured] = await db
        .select({ content: posts.content })
        .from(posts)
        .where(eq(posts.title, "Linear integration"));
      expect(featured!.content).toBe("An edit made while exploring the demo.");
      expect(await db.select({ count: count() }).from(posts)).toEqual([
        { count: 121 },
      ]);
      expect(
        await db
          .select({ count: count() })
          .from(auditLog)
          .where(eq(auditLog.eventType, "workspace.imported")),
      ).toEqual([{ count: 1 }]);
    });
    const env = contractEnv();
    await expect(env.scoped(env.b, seedPortalShowcase)).rejects.toThrow(
      "owned demo workspace",
    );
    await env.scoped(env.b, async (db) => {
      expect(await db.select({ id: posts.id }).from(posts)).toEqual([]);
    });
  }, 30000);
});
