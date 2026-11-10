import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../../database/schema";
import { settings } from "../../../database/quills/schema/auth";
import {
  helpCenterArticles,
  helpCenterCategories,
  helpCenterRedirectRules,
} from "../../../database/quills/schema/kb";
import { segments } from "../../../database/quills/schema/segments";
import quillsRouter from "../../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../../framework/contract";
import { call } from "../../feedback/taxonomy-harness.fixture";
import { germanEnabled, helpCenterIn } from "./seed.fixture";

let pool: Pool;
vi.mock("../../../database/index", () => ({
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
const send = (method: string, path: string, body?: unknown) => {
  const env = contractEnv();
  return call(app, env, env.owner, method, path, body);
};

describe.skipIf(!url)("Quills help center", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await startContract(pool, url!);
  }, 120000);
  afterAll(() => stopContract());

  it("keeps public URL IDs through updates, moves, publishing, translations and restore", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const created = await send("POST", "/help-center/articles", {
      title: "First steps",
      content: "Hello",
      categoryId: ids.categoryId,
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ status: "draft", publishedAt: null });
    const { id, urlId } = created.body;
    const path = `/help-center/articles/${id}`;

    const moved = await send("PATCH", path, {
      title: "Renamed",
      slug: "renamed",
      categoryId: ids.childIds[0],
      published: true,
    });
    expect(moved.body).toMatchObject({
      urlId,
      status: "published",
      transition: "published",
      autoTranslateRequested: false,
    });
    expect(
      (
        await send("PUT", `${path}/translations`, {
          locale: "de",
          title: "Hallo",
          content: "Hallo",
        })
      ).body,
    ).toMatchObject({ locale: "de", status: "draft" });
    const unpublished = await send("PATCH", path, { published: false });
    expect(unpublished.body).toMatchObject({
      urlId,
      status: "draft",
      transition: "unpublished",
    });
    expect((await send("DELETE", path)).status).toBe(200);
    expect((await send("GET", path)).status).toBe(404);
    expect((await send("POST", `${path}/restore`)).body).toMatchObject({
      urlId,
    });

    const category = `/help-center/categories/${ids.childIds[1]}`;
    const before = (await send("GET", category)).body.urlId;
    expect(
      (await send("PATCH", category, { name: "Moved", parentId: null })).status,
    ).toBe(200);
    expect(
      (
        await send("PUT", `${category}/translations`, {
          locale: "de",
          name: "Verschoben",
        })
      ).status,
    ).toBe(200);
    expect((await send("GET", category)).body).toMatchObject({
      urlId: before,
      parentId: null,
    });
  });

  it("lists drafts for teammates and filters on the published state", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const listed = (status: string) =>
      send(
        "GET",
        `/help-center/articles?categoryId=${ids.categoryId}&status=${status}&limit=100`,
      ).then((res) => res.body.articles.map((a: { id: string }) => a.id));
    expect(await listed("all")).toEqual(
      expect.arrayContaining([ids.articleId, ids.draftId]),
    );
    expect(await listed("published")).toEqual([ids.articleId]);
    expect(await listed("draft")).toEqual([ids.draftId]);
  });

  it("records the auto-translate request on publish without translating", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    await germanEnabled(env);
    await send("PATCH", "/help-center/settings", {
      autoTranslate: { enabled: true },
    });
    const published = await send(
      "PATCH",
      `/help-center/articles/${ids.draftId}`,
      {
        published: true,
      },
    );
    expect(published.body.autoTranslateRequested).toBe(true);
    const [event] = (
      await pool.query(
        "SELECT payload FROM quills.events WHERE workspace_id=$1 AND type='help_center.article_published' AND entity_id=$2",
        [env.a, ids.draftId],
      )
    ).rows;
    expect(event.payload).toEqual({ autoTranslate: "requested" });
    const translations = await send(
      "GET",
      `/help-center/articles/${ids.draftId}/translations`,
    );
    expect(translations.body).toMatchObject({
      translations: [],
      statuses: [{ locale: "de", status: "untranslated" }],
    });
    // The custom domain stays as stored.
    const [row] = (
      await pool.query(
        "SELECT help_center_config FROM quills.settings WHERE workspace_id=$1",
        [env.a],
      )
    ).rows;
    expect(JSON.parse(row.help_center_config).domain.domain).toBe(
      "help.example.test",
    );
  });

  it("keeps the category tree at most three levels deep and without cycles", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const child = ids.childIds[0]!;
    const grandchild = (
      await send("POST", "/help-center/categories", {
        name: "Leaf",
        parentId: child,
      })
    ).body.id;
    expect(
      (
        await send("POST", "/help-center/categories", {
          name: "Too deep",
          parentId: grandchild,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send("PATCH", `/help-center/categories/${ids.categoryId}`, {
          parentId: grandchild,
        })
      ).status,
    ).toBe(400);
    const foreign = await helpCenterIn(env, env.b);
    expect(
      (
        await send("PATCH", `/help-center/categories/${child}`, {
          parentId: foreign.categoryId,
        })
      ).status,
    ).toBe(404);
  });

  it("deletes a category with its descendants, their articles and redirect rules", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const res = await send(
      "DELETE",
      `/help-center/categories/${ids.categoryId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.categoryIds).toEqual(
      expect.arrayContaining([ids.categoryId, ...ids.childIds]),
    );
    const state = await env.scoped(env.a, async (db) => ({
      categories: await db
        .select({ deletedAt: helpCenterCategories.deletedAt })
        .from(helpCenterCategories)
        .where(eq(helpCenterCategories.parentId, ids.categoryId)),
      article: await db
        .select({ deletedAt: helpCenterArticles.deletedAt })
        .from(helpCenterArticles)
        .where(eq(helpCenterArticles.id, ids.articleId)),
      rules: await db
        .select()
        .from(helpCenterRedirectRules)
        .where(eq(helpCenterRedirectRules.id, ids.ruleId)),
    }));
    expect(state.categories).toHaveLength(2);
    expect(state.categories.every((row) => row.deletedAt)).toBe(true);
    expect(state.article[0]!.deletedAt).not.toBeNull();
    expect(state.rules).toEqual([]);
    // A child cannot come back before its parent.
    expect(
      (await send("POST", `/help-center/categories/${ids.childIds[0]}/restore`))
        .status,
    ).toBe(409);
  });

  it("reorders categories and articles all or nothing", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const foreign = await helpCenterIn(env, env.b);
    const children = (body: unknown) =>
      send("PUT", "/help-center/categories/order", body);
    const order = [...ids.childIds].reverse();
    expect(
      (await children({ parentId: ids.categoryId, categoryIds: order })).status,
    ).toBe(200);
    for (const [body, status] of [
      [{ parentId: ids.categoryId, categoryIds: order.slice(1) }, 409],
      [
        {
          parentId: ids.categoryId,
          categoryIds: [foreign.childIds[0], order[1]],
        },
        404,
      ],
      [{ parentId: ids.categoryId, categoryIds: [order[0], order[0]] }, 400],
    ] as const)
      expect((await children(body)).status).toBe(status);
    const positions = await env.scoped(env.a, (db) =>
      db
        .select({
          id: helpCenterCategories.id,
          position: helpCenterCategories.position,
        })
        .from(helpCenterCategories)
        .where(eq(helpCenterCategories.parentId, ids.categoryId)),
    );
    for (const row of positions)
      expect(row.position).toBe(order.indexOf(row.id));

    const articles = `/help-center/categories/${ids.categoryId}/articles/order`;
    expect(
      (await send("PUT", articles, { articleIds: [ids.articleId] })).status,
    ).toBe(409);
    expect(
      (
        await send("PUT", articles, {
          articleIds: [ids.articleId, foreign.draftId],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("PUT", articles, {
          articleIds: [ids.draftId, ids.articleId],
        })
      ).body,
    ).toEqual({ articleIds: [ids.draftId, ids.articleId] });
  });

  it("rejects segments and redirect targets of another workspace", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const foreign = await helpCenterIn(env, env.b);
    const [segment] = await env.scoped(env.b, (db) =>
      db
        .insert(segments)
        .values({ name: "B only", slug: env.id("segment") })
        .returning({ id: segments.id }),
    );
    expect(
      (
        await send("PATCH", `/help-center/articles/${ids.draftId}`, {
          segmentIds: [segment!.id],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("POST", "/help-center/redirect-rules", {
          path: "/old",
          targetType: "category",
          targetId: foreign.categoryId,
        })
      ).status,
    ).toBe(404);
    // A draft is not a redirect target.
    expect(
      (
        await send("POST", "/help-center/redirect-rules", {
          path: `/draft-${ids.draftId}`,
          targetType: "article",
          targetId: ids.draftId,
        })
      ).status,
    ).toBe(409);
  });
  it("rejects category segments of another workspace and moves that break the depth", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const [segment] = await env.scoped(env.b, (db) =>
      db
        .insert(segments)
        .values({ name: "B only", slug: env.id("segment") })
        .returning({ id: segments.id }),
    );
    const foreignSegment = { segmentIds: [segment!.id] };
    expect(
      (
        await send("POST", "/help-center/categories", {
          name: "X",
          ...foreignSegment,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          "PATCH",
          `/help-center/categories/${ids.categoryId}`,
          foreignSegment,
        )
      ).status,
    ).toBe(404);
    // A child with its own child cannot move under its sibling: four levels.
    const [first, second] = ids.childIds as [string, string];
    expect(
      (
        await send("POST", "/help-center/categories", {
          name: "Leaf",
          parentId: first,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send("PATCH", `/help-center/categories/${first}`, {
          parentId: second,
        })
      ).status,
    ).toBe(400);
  });

  it("refuses a category restore that would make the tree four levels deep", async () => {
    const make = async (name: string, parentId?: string) =>
      (await send("POST", "/help-center/categories", { name, parentId })).body
        .id as string;
    const a = await make("A");
    const b = await make("B", a);
    expect((await send("DELETE", `/help-center/categories/${b}`)).status).toBe(
      200,
    );
    const y = await make("Y", await make("X"));
    expect(
      (await send("PATCH", `/help-center/categories/${a}`, { parentId: y }))
        .status,
    ).toBe(200);
    expect(
      (await send("POST", `/help-center/categories/${b}/restore`)).status,
    ).toBe(400);
  });

  it("restores an article only into a live category", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    await send("DELETE", `/help-center/categories/${ids.categoryId}`);
    expect(
      (await send("POST", `/help-center/articles/${ids.draftId}/restore`))
        .status,
    ).toBe(409);
    await send("POST", `/help-center/categories/${ids.categoryId}/restore`);
    expect(
      (await send("POST", `/help-center/articles/${ids.draftId}/restore`))
        .status,
    ).toBe(200);
  });

  it("files uncategorized articles under one General category, also after a General was deleted", async () => {
    const create = async () =>
      (
        await send("POST", "/help-center/articles", {
          title: "Loose",
          content: "x",
        })
      ).body.category.id as string;
    const general = await create();
    expect(await create()).toBe(general);
    await send("DELETE", `/help-center/categories/${general}`);
    const next = await create();
    expect(next).not.toBe(general);
    expect(await create()).toBe(next);
  });

  it("counts votes once per person and moves them when a vote changes", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    const counts = async (id: string) =>
      (await send("GET", `/help-center/articles/${id}`)).body as {
        helpfulCount: number;
        notHelpfulCount: number;
      };
    const vote = (id: string, helpful: boolean) =>
      send("POST", `/help-center/articles/${id}/feedback`, { helpful });

    // The seeded not-helpful vote with a reason flips to helpful.
    expect((await vote(ids.articleId, true)).body).toMatchObject({
      helpful: true,
      changed: true,
    });
    expect(await counts(ids.articleId)).toMatchObject({
      helpfulCount: 1,
      notHelpfulCount: 0,
    });
    expect(
      (
        await send(
          "GET",
          `/help-center/articles/${ids.articleId}/feedback-reasons`,
        )
      ).body,
    ).toEqual({ reasons: [] });
    expect((await vote(ids.articleId, true)).body).toMatchObject({
      changed: false,
    });
    expect(await counts(ids.articleId)).toMatchObject({
      helpfulCount: 1,
      notHelpfulCount: 0,
    });

    // Two votes at once from one person count once.
    const results = await Promise.all([
      vote(ids.draftId, false),
      vote(ids.draftId, false),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 200]);
    expect(await counts(ids.draftId)).toMatchObject({
      helpfulCount: 0,
      notHelpfulCount: 1,
    });
  });

  it("serializes concurrent category moves so they cannot build a cycle", async () => {
    const env = contractEnv();
    const make = async (name: string) =>
      (await send("POST", "/help-center/categories", { name })).body
        .id as string;
    const [a, b] = [await make("A"), await make("B")];
    const results = await Promise.all([
      send("PATCH", `/help-center/categories/${a}`, { parentId: b }),
      send("PATCH", `/help-center/categories/${b}`, { parentId: a }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
    const parents = await env.scoped(env.a, (db) =>
      db
        .select({
          id: helpCenterCategories.id,
          parentId: helpCenterCategories.parentId,
        })
        .from(helpCenterCategories)
        .where(inArray(helpCenterCategories.id, [a, b] as never[])),
    );
    expect(parents.filter((row) => row.parentId !== null)).toHaveLength(1);
  });

  it("handles locale edges and keeps a published translation published on save", async () => {
    const env = contractEnv();
    const ids = await helpCenterIn(env, env.a);
    await germanEnabled(env);
    expect(
      (await send("DELETE", "/help-center/settings/locales?locale=fr")).status,
    ).toBe(404);
    expect(
      (
        await send("PATCH", "/help-center/settings/locales", {
          locale: "fr",
          chrome: { homepageTitle: "Aide" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send("PUT", "/help-center/settings/locales", {
          locale: "en",
          chrome: {
            homepageTitle: "Help",
            homepageDescription: "",
            searchPlaceholder: "",
          },
        })
      ).status,
    ).toBe(400);
    const path = `/help-center/articles/${ids.articleId}/translations`;
    await send("PUT", `${path}/status`, { locale: "de", status: "published" });
    expect(
      (await send("PUT", path, { locale: "de", title: "Neu", content: "Neu" }))
        .body,
    ).toMatchObject({ title: "Neu", status: "published" });
  });

  it("keeps valid stored settings when one stored value is bad", async () => {
    const env = contractEnv();
    await env.scoped(env.a, (db) =>
      db.update(settings).set({
        helpCenterConfig: JSON.stringify({
          headerLinks: [{ label: "Docs", url: "/docs" }, { label: 1 }],
          locales: {
            additional: ["de", "ja"],
            chrome: {
              de: {
                homepageTitle: "Hilfe",
                homepageDescription: "",
                searchPlaceholder: "",
              },
              fr: "bad",
            },
          },
        }),
      }),
    );
    expect((await send("GET", "/help-center/settings")).body).toMatchObject({
      headerLinks: [{ label: "Docs", url: "/docs" }],
      locales: {
        additional: ["de"],
        chrome: [{ locale: "de", homepageTitle: "Hilfe" }],
      },
    });
    // A write of another section leaves the stored locales exactly as they were.
    await send("PATCH", "/help-center/settings", { seo: { indexable: false } });
    const [row] = (
      await pool.query(
        "SELECT help_center_config FROM quills.settings WHERE workspace_id=$1",
        [env.a],
      )
    ).rows;
    expect(JSON.parse(row.help_center_config).locales.additional).toEqual([
      "de",
      "ja",
    ]);
  });
});
