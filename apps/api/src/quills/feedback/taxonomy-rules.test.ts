import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { asc, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Database } from "../../database/quills/client";
import * as kaneo from "../../database/schema";
import { settings } from "../../database/quills/schema/auth";
import { roadmapColumns, roadmaps } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { events } from "../../database/quills/schema/events";
import { segments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import { call } from "./harness.fixture";
import { postIn, statusIn } from "./seeds.fixture";

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
const app = contractApp(quillsRouter);
const send = (method: string, path: string, body?: unknown) =>
  call(app, contractEnv(), contractEnv().owner, method, path, body);
const inA = <T>(work: (db: Database) => Promise<T>) =>
  contractEnv().scoped(contractEnv().a, work);

describe.skipIf(!url)("Quills taxonomy rules", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("a column of another roadmap is not found and stays unchanged", async () => {
    const env = contractEnv();
    const [first, second] = await inA((db) =>
      db
        .insert(roadmaps)
        .values([
          { name: "One", slug: env.id("one") },
          { name: "Two", slug: env.id("two") },
        ])
        .returning({ id: roadmaps.id }),
    );
    const statusId = await statusIn(env, env.a);
    const [column] = await inA((db) =>
      db
        .insert(roadmapColumns)
        .values({
          roadmapId: second!.id,
          statusId,
          name: "Now",
          color: "#000000",
        })
        .returning({ id: roadmapColumns.id }),
    );
    const path = `/roadmaps/${first!.id}/columns/${column!.id}`;
    expect((await send("PATCH", path, { name: "Moved" })).status).toBe(404);
    expect((await send("DELETE", path)).status).toBe(404);
    const [kept] = await inA((db) =>
      db
        .select({ name: roadmapColumns.name })
        .from(roadmapColumns)
        .where(eq(roadmapColumns.id, column!.id)),
    );
    expect(kept).toEqual({ name: "Now" });
  });

  it("a status that posts use, or the default status, cannot be deleted", async () => {
    const env = contractEnv();
    const used = await statusIn(env, env.a);
    await postIn(env, env.a, { statusId: used });
    expect((await send("DELETE", `/statuses/${used}`)).status).toBe(409);
    const [fallback] = await inA((db) =>
      db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.isDefault, true)),
    );
    expect((await send("DELETE", `/statuses/${fallback!.id}`)).status).toBe(
      409,
    );
    const unused = await statusIn(env, env.a);
    expect((await send("DELETE", `/statuses/${unused}`)).status).toBe(200);
    expect((await send("GET", `/statuses/${unused}`)).status).toBe(404);
  });

  it("records changelog.published once, when an entry becomes published", async () => {
    const env = contractEnv();
    const created = await send("POST", "/changelog", {
      title: "Draft",
      content: "Soon",
      publishState: { type: "draft" },
    });
    expect(created.body).toMatchObject({
      status: "draft",
      publishedNow: false,
    });
    const id = created.body.id as string;
    const update = (body: object) => send("PATCH", `/changelog/${id}`, body);
    expect((await update({ title: "Renamed" })).body.publishedNow).toBe(false);
    const published = await update({
      publishState: { type: "published" },
      notify: false,
    });
    expect(published.body).toMatchObject({
      status: "published",
      publishedNow: true,
    });
    expect((await update({ title: "Edited" })).body.publishedNow).toBe(false);
    const outbox = await inA((db) =>
      db
        .select({ type: events.type, payload: events.payload })
        .from(events)
        .where(eq(events.entityId, id))
        .orderBy(asc(events.id)),
    );
    expect(outbox).toEqual([
      { type: "changelog.created", payload: {} },
      { type: "changelog.updated", payload: {} },
      { type: "changelog.published", payload: { notify: "false" } },
      { type: "changelog.updated", payload: {} },
    ]);
    const past = new Date(Date.now() - 60000).toISOString();
    expect(
      (await update({ publishState: { type: "scheduled", publishAt: past } }))
        .status,
    ).toBe(400);
    // A foreign linked post fails the whole request.
    const foreign = await postIn(env, env.b);
    const before = await inA((db) =>
      db.select({ n: count() }).from(changelogEntries),
    );
    expect(
      (
        await send("POST", "/changelog", {
          title: "Linked",
          content: "Linked",
          publishState: { type: "draft" },
          linkedPostIds: [foreign.postId],
        })
      ).status,
    ).toBe(404);
    expect(
      await inA((db) => db.select({ n: count() }).from(changelogEntries)),
    ).toEqual(before);
  });

  it("settings routes write only their own key", async () => {
    const stored = () =>
      inA((db) =>
        db
          .select({
            name: settings.name,
            slug: settings.slug,
            metadata: settings.metadata,
            portalConfig: settings.portalConfig,
          })
          .from(settings),
      ).then((rows) => rows[0]!);
    await inA((db) =>
      db.update(settings).set({
        metadata: JSON.stringify({ officeHours: { enabled: true } }),
        portalConfig: JSON.stringify({ features: { voting: false } }),
      }),
    );
    const before = await stored();
    expect(
      (
        await send("PATCH", "/changelog/settings", {
          audience: "authenticated",
        })
      ).body,
    ).toEqual({
      audience: "authenticated",
      collaborationDisabled: false,
      autoSubscribe: true,
      emailsDisabled: false,
    });
    expect(
      (
        await send("PUT", "/moderation/default", {
          requireApproval: "anonymous",
        })
      ).body,
    ).toEqual({
      moderationDefault: {
        requireApproval: "anonymous",
        holdImages: false,
        holdLinks: false,
      },
    });
    const after = await stored();
    expect({ name: after.name, slug: after.slug }).toEqual({
      name: before.name,
      slug: before.slug,
    });
    expect(JSON.parse(after.metadata!)).toEqual({
      officeHours: { enabled: true },
      changelogSettings: { audience: "authenticated" },
    });
    expect(JSON.parse(after.portalConfig!)).toEqual({
      features: { voting: false },
      moderationDefault: {
        requireApproval: "anonymous",
        holdImages: false,
        holdLinks: false,
      },
    });
    // A stored value that is not a JSON object is never overwritten.
    await inA((db) => db.update(settings).set({ metadata: "not json" }));
    expect(
      (await send("PATCH", "/changelog/settings", { emailsDisabled: true }))
        .status,
    ).toBe(409);
    expect((await stored()).metadata).toBe("not json");
  });

  it("IDs inside lists and nested objects must belong to this workspace", async () => {
    const env = contractEnv();
    const segmentIn = async (workspaceId: string) => {
      const slug = env.id("segment");
      const [row] = await env.scoped(workspaceId, (db) =>
        db
          .insert(segments)
          .values({ name: slug, slug })
          .returning({ id: segments.id }),
      );
      return row!.id;
    };
    const own = await segmentIn(env.a);
    const foreign = await segmentIn(env.b);
    const foreignBoard = (await postIn(env, env.b)).boardId;
    const foreignStatus = await statusIn(env, env.b);
    const roadmap = (extra: object) =>
      send("POST", "/roadmaps", {
        name: "Nested",
        slug: env.id("nested").replaceAll("_", "-"),
        ...extra,
      });
    const segmentOnly = (ids: string[]) => ({
      visibility: "segment",
      visibleSegmentIds: ids,
    });
    const denied = [
      await roadmap({ baseFilter: { boardIds: [foreignBoard] } }),
      await roadmap({
        columns: [{ statusId: foreignStatus, name: "X", color: "#000000" }],
      }),
      await roadmap(segmentOnly([foreign])),
      await send("POST", "/changelog/categories", {
        name: env.id("category"),
        segmentIds: [foreign],
      }),
      await send("POST", "/changelog", {
        title: "Targeted",
        content: "Targeted",
        publishState: { type: "draft" },
        segmentIds: [foreign],
      }),
    ].map((res) => res.status);
    expect(denied).toEqual([404, 404, 404, 404, 404]);
    const allowed = await roadmap(segmentOnly([own]));
    expect(allowed.status).toBe(200);
    expect(allowed.body.visibleSegmentIds).toEqual([own]);
  });

  it("parallel default changes leave exactly one default status", async () => {
    const env = contractEnv();
    const candidates = await Promise.all(
      Array.from({ length: 6 }, () => statusIn(env, env.a)),
    );
    const results = await Promise.all(
      candidates.map((id) =>
        send("PATCH", `/statuses/${id}`, { isDefault: true }),
      ),
    );
    expect(results.map((res) => res.status)).toEqual(candidates.map(() => 200));
    const defaults = await inA((db) =>
      db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(eq(postStatuses.isDefault, true)),
    );
    expect(defaults).toHaveLength(1);
  });

  it("changelog cursor pages neither repeat nor skip entries", async () => {
    // Separate transactions give each entry its own microsecond timestamp.
    for (let i = 0; i < 3; i++)
      await inA((db) =>
        db
          .insert(changelogEntries)
          .values({ title: `Page ${i}`, content: "Paged" }),
      );
    const [total] = await inA((db) =>
      db
        .select({ n: count() })
        .from(changelogEntries)
        .where(isNull(changelogEntries.deletedAt)),
    );
    for (const sort of ["oldest", "newest"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await send(
          "GET",
          `/changelog?limit=1&sort=${sort}${cursor ? `&cursor=${cursor}` : ""}`,
        );
        seen.push(...res.body.entries.map((e: { id: string }) => e.id));
        cursor = res.body.nextCursor;
      } while (cursor && seen.length <= total!.n);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(total!.n);
    }
  });
});
