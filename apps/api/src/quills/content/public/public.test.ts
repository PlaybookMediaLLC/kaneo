import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PrincipalId, SegmentId } from "@kaneo/ids";
import * as kaneo from "../../../database/schema";
import { settings } from "../../../database/quills/schema/auth";
import {
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterRedirectRules,
  helpCenterSearchQueries,
} from "../../../database/quills/schema/kb";
import { unsubscribeTokens } from "../../../database/quills/schema/notifications";
import { userSegments } from "../../../database/quills/schema/segments";
import { statusSubscriptions } from "../../../database/quills/schema/status";
import quillsRouter from "../../index";
import publicRouter from "../../public";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../../framework/contract";
import { portalPaths } from "../../portal/paths";
import { helpContentIn, openPublic, statusContentIn } from "./seed.fixture";
import { likePattern } from "./help-center/search";
import { mintUnsubscribeToken } from "../../portal/unsubscribe-token";

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
vi.mock("../../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

async function call(
  method: string,
  path: string,
  options: { user?: string; bearer?: string; body?: unknown } = {},
) {
  const res = await app.request(`/quills-public/${contractEnv().a}${path}`, {
    method,
    headers: {
      ...(options.user && { "x-test-user": options.user }),
      ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
      "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await res.text();
  try {
    return { status: res.status, body: JSON.parse(raw) };
  } catch {
    // An XML document: the text.
    return { status: res.status, body: raw || null };
  }
}
const text = (value: unknown) => JSON.stringify(value);
const setSettings = (values: Partial<typeof settings.$inferInsert>) => {
  const env = contractEnv();
  return env.scoped(env.a, (db) => db.update(settings).set(values));
};
const join = (
  env: ReturnType<typeof contractEnv>,
  principalId: string,
  segmentId: string,
) =>
  env.scoped(env.a, (db) =>
    db.insert(userSegments).values({
      principalId: principalId as PrincipalId,
      segmentId: segmentId as SegmentId,
    }),
  );

describe("likePattern", () => {
  it("takes wildcards and the escape character literally", () => {
    expect(likePattern("50%_off\\x")).toBe("%50\\%\\_off\\\\x%");
  });
});

describe.skipIf(!url)(
  "Quills public help center, status page and widget help",
  () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
    }, 120000);
    afterAll(() => stopContract());

    it("opens the help center only with the portal and the module on, and behind the private portal", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await helpContentIn(env, env.a);
      expect((await call("GET", "/hc")).status).toBe(200);

      await setSettings({ portalConfig: JSON.stringify({ enabled: false }) });
      expect((await call("GET", "/hc")).status).toBe(404);
      expect((await call("GET", "/hc/sitemap.xml")).status).toBe(404);
      await setSettings({ portalConfig: JSON.stringify({ enabled: true }) });

      await setSettings({
        featureFlags: JSON.stringify({ helpCenter: false }),
      });
      expect((await call("GET", "/hc")).status).toBe(404);
      // The widget has its own switch but needs the module too.
      expect((await call("GET", "/widget/help/categories")).status).toBe(404);
      await openPublic(env);
      await setSettings({ widgetConfig: JSON.stringify({ enabled: false }) });
      expect((await call("GET", "/widget/help/categories")).status).toBe(404);
      expect(
        (await call("POST", "/widget/kb-search", { body: { query: "x" } }))
          .status,
      ).toBe(404);
      await openPublic(env);

      await setSettings({
        portalConfig: JSON.stringify({
          enabled: true,
          access: { visibility: "private", allowedDomains: [] },
        }),
      });
      expect((await call("GET", "/hc")).status).toBe(404);
      // A member passes the private-portal team grant and still reads as a visitor.
      const member = await call("GET", "/hc", { user: env.owner });
      expect(member.status).toBe(200);
      expect(text(member.body)).not.toContain(`${ids.label} draft`);
      await openPublic(env);
    });

    it("shows published public articles only, with the segment gate and locale rules", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await helpContentIn(env, env.a);
      const page = await call("GET", `/hc/categories/${ids.category.slug}`);
      expect(page.status).toBe(200);
      const titles = page.body.articles.map((a: { title: string }) => a.title);
      expect(titles).toEqual([`${ids.label} published`, `${ids.label} second`]);
      // The count leaves out the draft, deleted, scheduled and gated articles.
      expect(page.body.category.articleCount).toBe(2);
      for (const hidden of ids.hidden)
        expect(text(page.body)).not.toContain(hidden);
      expect(page.body.canonicalPath).toBe(
        `/hc/en/collections/${ids.category.urlId}-${ids.category.slug}`,
      );

      // A segment member also reads the gated category and article.
      const customer = await env.portalCustomer(env.a, env.customerA);
      await join(env, customer.principalId, ids.segmentId);
      const gated = await call("GET", `/hc/categories/${ids.category.slug}`, {
        user: env.customerA,
      });
      expect(text(gated.body)).toContain(`${ids.label} gated article`);
      expect(gated.body.category.articleCount).toBe(3);
      expect(text(gated.body)).not.toContain(`${ids.label} draft`);
      const home = await call("GET", "/hc", { user: env.customerA });
      expect(text(home.body)).toContain(`${ids.label} gated category`);
      expect(text(home.body)).not.toContain(`${ids.label} private category`);

      // German: the published translation, never a draft translation or a draft's translation.
      const german = await call(
        "GET",
        `/hc/categories/${ids.category.slug}?locale=de`,
      );
      expect(german.body.category.name).toBe(`${ids.label} oeffentlich`);
      expect(
        german.body.articles.map((a: { title: string }) => a.title),
      ).toEqual([`${ids.label} veroeffentlicht`]);
      const idSlug = `${ids.published.urlId}-${ids.published.slug}`;
      const article = await call("GET", `/hc/articles/${idSlug}?locale=de`);
      expect(article.body.article).toMatchObject({
        title: `${ids.label} veroeffentlicht`,
        content: `${ids.label} Inhalt`,
        path: `/hc/de/articles/${idSlug}`,
      });
      expect(text(article.body)).not.toMatch(/helpfulCount|notHelpfulCount/);
      expect(
        (await call("GET", `/hc/articles/${idSlug}?locale=fr`)).status,
      ).toBe(404);
      const [draft] = await env.scoped(env.a, (db) =>
        db
          .select({ urlId: helpCenterArticles.urlId })
          .from(helpCenterArticles)
          .where(eq(helpCenterArticles.id, ids.draftId)),
      );
      expect((await call("GET", `/hc/articles/${draft!.urlId}-x`)).status).toBe(
        404,
      );
    });

    it("searches literally, records the search and never finds hidden articles", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await helpContentIn(env, env.a);
      const found = await call("POST", "/hc/search", {
        body: { query: ids.label },
      });
      expect(found.status).toBe(200);
      expect(
        found.body.articles.map((a: { title: string }) => a.title).sort(),
      ).toEqual([`${ids.label} published`, `${ids.label} second`]);
      // `%` is not a wildcard: it matches no title.
      const wildcard = await call("POST", "/hc/search", {
        body: { query: "%" },
      });
      expect(wildcard.body.articles).toEqual([]);
      const german = await call("POST", "/widget/kb-search", {
        body: { query: ids.label, locale: "de" },
      });
      expect(
        german.body.articles.map((a: { title: string }) => a.title),
      ).toEqual([`${ids.label} veroeffentlicht`]);
      const logged = await env.scoped(env.a, (db) =>
        db
          .select({
            query: helpCenterSearchQueries.query,
            n: helpCenterSearchQueries.resultsCount,
          })
          .from(helpCenterSearchQueries)
          .where(eq(helpCenterSearchQueries.query, ids.label)),
      );
      expect(logged.map((row) => row.n).sort()).toEqual([1, 2]);
    });

    it("lists sitemap entries for public pages only and closes it with indexing off", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await helpContentIn(env, env.a);
      const sitemap = await call("GET", "/hc/sitemap.xml");
      const idSlug = `${ids.published.urlId}-${ids.published.slug}`;
      const page = (locale: string, idSlug: string) =>
        portalPaths.helpCenterArticle(env.a, locale, idSlug);
      const entry = (sitemap.body as string)
        .split("<url>")
        .find((block) => block.includes(`<loc>${page("en", idSlug)}</loc>`));
      expect(entry).toContain(
        `<xhtml:link rel="alternate" hreflang="en" href="${page("en", idSlug)}" />`,
      );
      expect(entry).toContain(
        `<xhtml:link rel="alternate" hreflang="de" href="${page("de", idSlug)}" />`,
      );
      // Exactly these two alternates, as the JSON entries had before.
      expect(entry!.split("<xhtml:link").length - 1).toBe(2);
      for (const hidden of ids.hiddenPaths)
        expect(sitemap.body).not.toContain(hidden);
      await setSettings({
        helpCenterConfig: JSON.stringify({ seo: { indexable: false } }),
      });
      expect((await call("GET", "/hc/sitemap.xml")).status).toBe(404);
    });

    it("resolves redirects only to public targets", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await helpContentIn(env, env.a);
      const live = await call(
        "GET",
        `/hc/redirect?path=${encodeURIComponent(`${ids.redirectPath}/`)}`,
      );
      expect(live.body.target).toBe(
        `/hc/en/articles/${ids.published.urlId}-${ids.published.slug}`,
      );
      await env.scoped(env.a, (db) =>
        db.insert(helpCenterRedirectRules).values({
          path: `${ids.redirectPath}-draft`,
          targetType: "article",
          targetId: ids.draftId,
        }),
      );
      const draft = await call(
        "GET",
        `/hc/redirect?path=${ids.redirectPath}-draft`,
      );
      expect(draft.body.target).toBeNull();
    });

    it("keeps one vote per visitor, counts anonymous votes and takes a reason once", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await helpContentIn(env, env.a);
      const path = `/hc/articles/${ids.published.id}/feedback`;
      const counts = async () =>
        (
          await env.scoped(env.a, (db) =>
            db
              .select({
                yes: helpCenterArticles.helpfulCount,
                no: helpCenterArticles.notHelpfulCount,
              })
              .from(helpCenterArticles)
              .where(eq(helpCenterArticles.id, ids.published.id)),
          )
        )[0];
      const anonymous = await call("POST", path, { body: { helpful: false } });
      expect(anonymous.body).toMatchObject({ helpful: false, changed: true });
      for (const helpful of [true, false, true])
        await call("POST", path, { user: env.customerA, body: { helpful } });
      expect(await counts()).toEqual({ yes: 1, no: 1 });

      // A widget visitor sets desired state: a repeat changes nothing.
      const visitor = await env.widgetVisitor(env.a);
      const widgetPath = `/widget/help/articles/${ids.published.id}/feedback`;
      expect(
        (
          await call("PUT", widgetPath, {
            bearer: visitor.token,
            body: { helpful: false },
          })
        ).body.changed,
      ).toBe(true);
      expect(
        (
          await call("PUT", widgetPath, {
            bearer: visitor.token,
            body: { helpful: false },
          })
        ).body.changed,
      ).toBe(false);
      expect(await counts()).toEqual({ yes: 1, no: 2 });
      const read = await call(
        "GET",
        `/widget/help/articles/${ids.published.id}`,
        {
          bearer: visitor.token,
        },
      );
      expect(read.body.helpful).toBe(false);
      expect(
        (await call("PUT", widgetPath, { body: { helpful: true } })).status,
      ).toBe(401);

      const reasonPath = `/hc/feedback/${anonymous.body.feedbackId}/reason`;
      expect(
        (await call("POST", reasonPath, { body: { reason: "Too short" } }))
          .status,
      ).toBe(200);
      expect(
        (await call("POST", reasonPath, { body: { reason: "Again" } })).status,
      ).toBe(404);
      // A signed-in visitor's vote takes a reason from that visitor only.
      const no = await call("POST", path, {
        user: env.customerB,
        body: { helpful: false },
      });
      const theirs = `/hc/feedback/${no.body.feedbackId}/reason`;
      expect(
        (
          await call("POST", theirs, {
            user: env.customerA,
            body: { reason: "x" },
          })
        ).status,
      ).toBe(404);
      expect(
        (await call("POST", theirs, { body: { reason: "x" } })).status,
      ).toBe(404);
      expect(
        (
          await call("POST", theirs, {
            user: env.customerB,
            body: { reason: "x" },
          })
        ).status,
      ).toBe(200);
      const [stored] = await env.scoped(env.a, (db) =>
        db
          .select({ reason: helpCenterArticleFeedback.reason })
          .from(helpCenterArticleFeedback)
          .where(eq(helpCenterArticleFeedback.id, anonymous.body.feedbackId)),
      );
      expect(stored!.reason).toBe("Too short");
      // A draft takes no vote.
      expect(
        (
          await call("POST", `/hc/articles/${ids.draftId}/feedback`, {
            body: { helpful: true },
          })
        ).status,
      ).toBe(404);
    });

    it("falls back to the default locale for a widget article without a published translation", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await helpContentIn(env, env.a);
      const second = await call(
        "GET",
        `/widget/help/articles/${ids.published.slug.replace("published", "second")}?locale=de`,
      );
      expect(second.body).toMatchObject({
        locale: "en",
        title: `${ids.label} second`,
        helpful: null,
      });
      // The widget sends its UI tag: de-DE reads German; pt-BR (not enabled) and ja read English.
      const translated = await call(
        "GET",
        `/widget/help/articles/${ids.published.id}?locale=de-DE`,
      );
      expect(translated.body).toMatchObject({
        locale: "de",
        title: `${ids.label} veroeffentlicht`,
      });
      for (const tag of ["pt-BR", "ja"]) {
        const found = await call("POST", "/widget/kb-search", {
          body: { query: ids.label, locale: tag },
        });
        expect(found.status).toBe(200);
        expect(found.body.locale).toBe("en");
      }
      expect(
        (await call("GET", `/widget/help/articles/${ids.draftId}`)).status,
      ).toBe(404);
    });

    it("gates the status page and its components and never reveals a hidden component", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await statusContentIn(env, env.a);
      const page = await call("GET", "/status");
      expect(page.status).toBe(200);
      for (const hidden of ids.hidden)
        expect(text(page.body)).not.toContain(hidden);
      const open = page.body.activeIncidents.find(
        (i: { id: string }) => i.id === ids.incidentId,
      );
      // The gated major outage is hidden, so the visible component sets the impact.
      expect(open).toMatchObject({
        impact: "minor",
        affectedComponents: [
          { id: ids.componentId, componentStatus: "degraded_performance" },
        ],
      });
      expect(
        page.body.recentIncidents.flatMap(
          (d: { incidents: { id: string }[] }) => d.incidents.map((i) => i.id),
        ),
      ).toContain(ids.resolvedId);

      const customer = await env.portalCustomer(env.a, env.customerA);
      await join(env, customer.principalId, ids.segmentId);
      const member = await call("GET", `/status/incidents/${ids.incidentId}`, {
        user: env.customerA,
      });
      expect(member.body.impact).toBe("critical");
      expect(text(member.body)).toContain(`${ids.label} gated component`);
      // An incident on a gated component only: 404 for a visitor, readable for a member.
      const privatePath = `/status/incidents/${ids.privateId}`;
      expect((await call("GET", privatePath)).status).toBe(404);
      expect(
        (await call("GET", privatePath, { user: env.customerA })).status,
      ).toBe(200);

      // History pages by cursor without a repeat or a gap. For the member, the seed's two
      // resolved incidents share one start time (one transaction), so the cursor meets a tie.
      await statusContentIn(env, env.a);
      const pages: string[] = [];
      let cursor = "";
      for (let n = 0; n < 3; n++) {
        const next = await call(
          "GET",
          `/status/history?limit=1${cursor && `&cursor=${cursor}`}`,
          { user: env.customerA },
        );
        pages.push(...next.body.items.map((i: { id: string }) => i.id));
        cursor = next.body.nextCursor;
      }
      const whole = await call("GET", "/status/history?limit=50", {
        user: env.customerA,
      });
      expect(pages).toEqual(
        whole.body.items.slice(0, 3).map((i: { id: string }) => i.id),
      );
      const anonymous = await call("GET", "/status/history?limit=50");
      for (const hidden of ids.hidden)
        expect(text(anonymous.body)).not.toContain(hidden);
      const feed = await call("GET", "/status/rss.xml");
      expect(feed.body).toContain(
        `<link>${portalPaths.statusIncident(env.a, ids.incidentId)}</link>`,
      );
      for (const hidden of ids.hidden)
        expect(text(feed.body)).not.toContain(hidden);
      // One item per update, open incidents first: with limit=1 only the newest open incident's
      // item stays (the second seed above opened a newer one), and no resolved item.
      const items = (body: string) =>
        [
          ...body.matchAll(/<link>[^<]*\/status\/incidents\/([^<#]+)<\/link>/g),
        ].map((match) => match[1]);
      expect(items(feed.body)).toEqual(
        expect.arrayContaining([ids.incidentId, ids.resolvedId]),
      );
      const limited = items(
        (await call("GET", "/status/rss.xml?limit=1")).body,
      );
      expect(limited).toHaveLength(1);
      expect(limited).not.toContain(ids.resolvedId);

      const metadata = (statusSettings: object) =>
        setSettings({ metadata: JSON.stringify({ statusSettings }) });
      await metadata({ enabled: false, audience: "public" });
      expect((await call("GET", "/status")).status).toBe(404);
      await metadata({ enabled: true, audience: "public" });
      await setSettings({
        portalConfig: JSON.stringify({
          enabled: true,
          access: { visibility: "private", allowedDomains: [] },
        }),
      });
      expect((await call("GET", "/status")).status).toBe(404);
      expect((await call("GET", "/status/rss.xml")).status).toBe(404);
      await openPublic(env);
      await metadata({ enabled: true, audience: "authenticated" });
      expect((await call("GET", "/status")).status).toBe(404);
      expect(
        (await call("GET", "/status", { user: env.customerB })).status,
      ).toBe(200);
      await metadata({
        enabled: true,
        audience: "segments",
        allowedSegmentIds: [ids.segmentId],
      });
      expect(
        (await call("GET", "/status", { user: env.customerB })).status,
      ).toBe(404);
      expect(
        (await call("GET", "/status", { user: env.customerA })).status,
      ).toBe(200);
      await setSettings({
        featureFlags: JSON.stringify({ statusPage: false }),
      });
      expect(
        (await call("GET", "/status", { user: env.customerA })).status,
      ).toBe(404);
      await openPublic(env);
    });

    it("subscribes to visible components only and unsubscribes through a hashed one-time token", async () => {
      const env = contractEnv();
      await openPublic(env);
      const ids = await statusContentIn(env, env.a);
      const gated = await call("PUT", "/status/subscription", {
        user: env.customerB,
        body: { scope: "components", componentIds: [ids.gatedComponentId] },
      });
      expect(gated.status).toBe(404);
      const page = await call("PUT", "/status/subscription", {
        user: env.customerB,
        body: { scope: "page" },
      });
      expect(page.body).toMatchObject({
        subscribed: true,
        scope: "page",
        changed: true,
      });
      expect(
        (await call("GET", "/status/subscription", { user: env.customerB }))
          .body.subscribed,
      ).toBe(true);

      const customer = await env.portalCustomer(env.a, env.customerB);
      const principalId = customer.principalId as PrincipalId;
      const token = await env.scoped(env.a, (db) =>
        mintUnsubscribeToken(db, principalId, "unsubscribe_status"),
      );
      const stored = await env.scoped(env.a, (db) =>
        db
          .select({ token: unsubscribeTokens.token })
          .from(unsubscribeTokens)
          .where(eq(unsubscribeTokens.principalId, principalId)),
      );
      expect(stored.map((row) => row.token)).not.toContain(token);
      expect(
        (await call("POST", "/status/unsubscribe", { body: { token } })).body
          .changed,
      ).toBe(true);
      // Spent: a second use changes nothing, even after a new subscription.
      await call("PUT", "/status/subscription", {
        user: env.customerB,
        body: { scope: "page" },
      });
      expect(
        (await call("POST", "/status/unsubscribe", { body: { token } })).body
          .changed,
      ).toBe(false);
      const expired = await env.scoped(env.a, (db) =>
        mintUnsubscribeToken(
          db,
          principalId,
          "unsubscribe_status",
          null,
          new Date(Date.now() - 1000),
        ),
      );
      expect(
        (
          await call("POST", "/status/unsubscribe", {
            body: { token: expired },
          })
        ).body.changed,
      ).toBe(false);
      // Workspace B's token does nothing in A.
      const foreign = await env.portalCustomer(env.b, env.customerB);
      const otherToken = await env.scoped(env.b, (db) =>
        mintUnsubscribeToken(
          db,
          foreign.principalId as PrincipalId,
          "unsubscribe_status",
        ),
      );
      expect(
        (
          await call("POST", "/status/unsubscribe", {
            body: { token: otherToken },
          })
        ).body.changed,
      ).toBe(false);
      const [row] = await env.scoped(env.a, (db) =>
        db
          .select({ unsubscribedAt: statusSubscriptions.unsubscribedAt })
          .from(statusSubscriptions)
          .where(eq(statusSubscriptions.principalId, principalId)),
      );
      expect(row!.unsubscribedAt).toBeNull();

      // Opting out works while the page is closed; subscribing does not.
      await setSettings({
        metadata: JSON.stringify({ statusSettings: { enabled: false } }),
      });
      const mine = await call("GET", "/status/subscription", {
        user: env.customerB,
      });
      expect(mine.body.subscribed).toBe(true);
      const left = await call("DELETE", "/status/subscription", {
        user: env.customerB,
      });
      expect(left.body).toMatchObject({ subscribed: false, changed: true });
      expect(
        (await call("DELETE", "/status/subscription", { user: env.customerB }))
          .body.changed,
      ).toBe(false);
      expect(
        (
          await call("PUT", "/status/subscription", {
            user: env.customerB,
            body: { scope: "page" },
          })
        ).status,
      ).toBe(404);
      await openPublic(env);
      await call("PUT", "/status/subscription", {
        user: env.customerB,
        body: { scope: "page" },
      });
      const closedToken = await env.scoped(env.a, (db) =>
        mintUnsubscribeToken(db, principalId, "unsubscribe_status"),
      );
      await setSettings({
        metadata: JSON.stringify({ statusSettings: { enabled: false } }),
      });
      expect(
        (
          await call("POST", "/status/unsubscribe", {
            body: { token: closedToken },
          })
        ).body.changed,
      ).toBe(true);
      await openPublic(env);
    });
  },
);
