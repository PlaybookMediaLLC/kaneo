import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as kaneo from "../database/schema";
import { withQuillsSystemWorkspace } from "../database/quills/client";
import { aiUsageLog } from "../database/quills/schema/ai-usage-log";
import { assistantInvolvements } from "../database/quills/schema/assistant";
import { principal, settings } from "../database/quills/schema/auth";
import { boards } from "../database/quills/schema/boards";
import { companies } from "../database/quills/schema/companies";
import { conversations } from "../database/quills/schema/conversation";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../database/quills/schema/kb";
import { posts } from "../database/quills/schema/posts";
import { postStatuses } from "../database/quills/schema/statuses";
import { checkAiBudget } from "./assistant/budget";
import { searchArticles as retrieveAiArticles } from "./assistant/engine/retrieval";
import { computeFairDemandScore } from "./feedback/hygiene";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "./framework/contract";
import quillsRouter from "./index";
import { flagOverdueAndUnhelpfulArticles } from "./jobs/handlers/sweeps";
import publicRouter from "./public";

process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY ||= "wave3-test-encryption-key";

let pool: Pool;
vi.mock("../database/index", () => ({
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
vi.mock("../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);

describe.skipIf(!url)(
  "Wave 3: Intelligence & Content (#302, #314, #315, #304)",
  () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
      await contractEnv().scoped(contractEnv().a, async (db) => {
        await db.update(settings).set({
          featureFlags: JSON.stringify({ helpCenter: true }),
          portalConfig: JSON.stringify({ enabled: true }),
          widgetConfig: JSON.stringify({
            enabled: true,
            tabs: ["home", "messages", "help", "feedback"],
          }),
        } as never);
      });
    }, 120_000);

    afterAll(() => stopContract());

    async function teamJson(
      method: string,
      path: string,
      opts?: { body?: unknown; user?: string },
    ): Promise<{ status: number; body: any }> {
      const res = await app.request(`/quills/${contractEnv().a}${path}`, {
        method,
        headers: {
          "x-test-user": opts?.user ?? contractEnv().owner,
          ...(opts?.body !== undefined && {
            "content-type": "application/json",
          }),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }

    async function pubJson(
      method: string,
      path: string,
      opts?: { bearer?: string; body?: unknown },
    ): Promise<{ status: number; body: any }> {
      const res = await app.request(
        `/quills-public/${contractEnv().a}${path}`,
        {
          method,
          headers: {
            ...(opts?.bearer && { authorization: `Bearer ${opts.bearer}` }),
            ...(opts?.body !== undefined && {
              "content-type": "application/json",
            }),
          },
          body:
            opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        },
      );
      return { status: res.status, body: await res.json().catch(() => null) };
    }

    // -------------------------------------------------------------------------
    // #302: AI Budgets, BYOK & Honest Resolutions
    // -------------------------------------------------------------------------
    it("#302 enforces workspace USD budget caps, seals BYOK keys without leakage, and separates confirmed vs assumed vs reopened resolutions", async () => {
      const wsId = contractEnv().a;
      const patchRes = await teamJson("PATCH", "/assistant/budget", {
        body: {
          dailyCapUsd: 1.0,
          monthlyCapUsd: 25.0,
          alertThresholdPercent: 80,
          degradeBehavior: "draft_mode",
        },
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.config.dailyCapUsd).toBe(1);
      expect(patchRes.body.config.degradeBehavior).toBe("draft_mode");

      const secretKey = "sk-byok-super-secret-value-99999";
      const byokRes = await teamJson("PUT", "/assistant/provider-keys", {
        body: {
          providerName: "openai",
          baseUrl: "https://api.openai.com/v1",
          apiKey: secretKey,
          chatModel: "gpt-4o-mini",
        },
      });
      expect(byokRes.status).toBe(200);
      expect(byokRes.body.provider.hasCustomKey).toBe(true);
      expect(JSON.stringify(byokRes.body)).not.toContain(secretKey);

      await withQuillsSystemWorkspace(wsId, async (db) => {
        await db.insert(aiUsageLog).values({
          pipelineStep: "customer_agent",
          callType: "chat_completion",
          model: "gpt-4o",
          inputTokens: 10000,
          outputTokens: 5000,
          totalTokens: 15000,
          costUsd: "1.250000",
          estimatedCostUsd: "1.250000",
          durationMs: 420,
          status: "success",
        });
        const check = await checkAiBudget(db);
        expect(check.degradedMode).toBe("draft_mode");
        expect(check.alertTriggered).toBe(true);
        expect(check.reason).toBe("daily_usd_cap_reached");
      });

      const getBudget = await teamJson("GET", "/assistant/budget");
      expect(getBudget.status).toBe(200);
      expect(getBudget.body.usage.dailySpendUsd).toBeGreaterThanOrEqual(1.25);
      expect(getBudget.body.usage.degradedMode).toBe("draft_mode");
      expect(getBudget.body.provider.hasCustomKey).toBe(true);
      expect(JSON.stringify(getBudget.body)).not.toContain(secretKey);

      await contractEnv().scoped(wsId, async (db) => {
        const [p] = await db
          .insert(principal)
          .values({
            type: "customer",
            displayName: "Honest Alice",
            createdAt: new Date(),
          })
          .returning({ id: principal.id });
        const [c1] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: p!.id,
            channel: "messenger",
            status: "open",
          })
          .returning({ id: conversations.id });
        const [c2] = await db
          .insert(conversations)
          .values({
            visitorPrincipalId: p!.id,
            channel: "messenger",
            status: "closed",
          })
          .returning({ id: conversations.id });
        await db.insert(assistantInvolvements).values([
          {
            conversationId: c1!.id,
            triggeredBy: "first_touch",
            status: "resolved_confirmed",
          },
          {
            conversationId: c2!.id,
            triggeredBy: "first_touch",
            status: "resolved_assumed",
            reopenedAfterResolutionAt: new Date(),
          },
        ]);
      });

      const today = new Date().toISOString().slice(0, 10);
      const perf = await teamJson(
        "GET",
        `/assistant/analytics/performance?from=${today}&to=${today}`,
      );
      expect(perf.status).toBe(200);
      expect(perf.body.confirmedResolutions).toBe(1);
      expect(perf.body.assumedResolutions).toBe(1);
      expect(perf.body.reopenedAfterResolution).toBe(1);
      expect(perf.body.confirmedResolutionRate).toBe(0.5);
      expect(perf.body.assumedResolutionRate).toBe(0.5);

      const ssrfByok = await teamJson("PUT", "/assistant/provider-keys", {
        body: {
          providerName: "custom",
          baseUrl: "http://127.0.0.1:8080/v1",
          apiKey: "sk-ssrf-test",
        },
      });
      expect(ssrfByok.status).toBe(400);

      const { estimateCallCostUsd } = await import("./assistant/budget");
      const miniCost = Number(
        estimateCallCostUsd({
          model: "gpt-4o-mini",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          totalTokens: 2_000_000,
          durationMs: 0,
        }),
      );
      const fullCost = Number(
        estimateCallCostUsd({
          model: "gpt-4o",
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          totalTokens: 2_000_000,
          durationMs: 0,
        }),
      );
      expect(miniCost).toBeLessThan(fullCost);

      const delKey = await teamJson("DELETE", "/assistant/provider-keys");
      expect(delKey.status).toBe(200);
      expect(delKey.body.provider.hasCustomKey).toBe(false);
    });

    // -------------------------------------------------------------------------
    // #314: KB Owners, Review Schedule & Staleness
    // -------------------------------------------------------------------------
    it("#314 flags stale KB articles (manual, overdue, unhelpful spike, changelog publish) and excludes them from AI grounding until reviewed", async () => {
      const wsId = contractEnv().a;
      const seeded = await contractEnv().scoped(wsId, async (db, actor) => {
        const [cat] = await db
          .insert(helpCenterCategories)
          .values({
            name: "Billing Docs",
            slug: "billing-docs-w3",
            isPublic: true,
          })
          .returning({ id: helpCenterCategories.id });
        const [art1] = await db
          .insert(helpCenterArticles)
          .values({
            categoryId: cat!.id,
            slug: "refund-policy-v1-w3",
            title: "Refund Policy Guide",
            content:
              "Refunds are processed within 5 business days for eligible subscriptions.",
            principalId: actor.principalId,
            publishedAt: new Date(),
          })
          .returning({ id: helpCenterArticles.id });
        const [art2] = await db
          .insert(helpCenterArticles)
          .values({
            categoryId: cat!.id,
            slug: "overdue-guide-w3",
            title: "Overdue SSO Setup",
            content: "Legacy SAML instructions.",
            principalId: actor.principalId,
            publishedAt: new Date(),
            reviewBy: new Date(Date.now() - 86_400_000),
          })
          .returning({ id: helpCenterArticles.id });
        const [art3] = await db
          .insert(helpCenterArticles)
          .values({
            categoryId: cat!.id,
            slug: "unhelpful-guide-w3",
            title: "Broken Export Instructions",
            content: "Old export flow.",
            principalId: actor.principalId,
            publishedAt: new Date(),
            helpfulCount: 2,
            notHelpfulCount: 4,
          })
          .returning({ id: helpCenterArticles.id });
        return {
          art1: art1!.id,
          art2: art2!.id,
          art3: art3!.id,
          actorId: actor.principalId,
        };
      });

      const beforeAi = await withQuillsSystemWorkspace(wsId, (db) =>
        retrieveAiArticles(db, "Refund Policy", "public"),
      );
      expect(beforeAi.some((s) => s.id === seeded.art1)).toBe(true);

      const flagRes = await teamJson(
        "POST",
        `/help-center/articles/${seeded.art1}/flag-stale`,
        {
          body: {
            reason: "product_change",
            details: "New 14-day refund window",
          },
        },
      );
      expect(flagRes.status).toBe(200);
      expect(flagRes.body.staleReason).toBe("product_change");

      const staleAi = await withQuillsSystemWorkspace(wsId, (db) =>
        retrieveAiArticles(db, "Refund Policy", "public"),
      );
      expect(staleAi.some((s) => s.id === seeded.art1)).toBe(false);

      await withQuillsSystemWorkspace(wsId, (db) =>
        flagOverdueAndUnhelpfulArticles(db),
      );

      const queueRes = await teamJson("GET", "/help-center/review-queue");
      expect(queueRes.status).toBe(200);
      const byId = new Map<string, { id: string; staleReason: string }>(
        queueRes.body.items.map((item: { id: string; staleReason: string }) => [
          item.id,
          item,
        ]),
      );
      expect(byId.get(seeded.art1)?.staleReason).toBe("product_change");
      expect(byId.get(seeded.art2)?.staleReason).toBe("review_overdue");
      expect(byId.get(seeded.art3)?.staleReason).toBe("unhelpful_spike");

      const revRes = await teamJson(
        "POST",
        `/help-center/articles/${seeded.art1}/mark-reviewed`,
        { body: { nextReviewDays: 90 } },
      );
      expect(revRes.status).toBe(200);
      expect(revRes.body.staleFlaggedAt).toBeNull();
      expect(revRes.body.lastReviewedAt).toBeTruthy();

      const afterReviewAi = await withQuillsSystemWorkspace(wsId, (db) =>
        retrieveAiArticles(db, "Refund Policy", "public"),
      );
      expect(afterReviewAi.some((s) => s.id === seeded.art1)).toBe(true);

      const draftCl = await teamJson("POST", "/changelog", {
        body: {
          title: "Updated Refund Rules",
          content: "We updated refund processing.",
          publishState: { type: "draft" },
        },
      });
      expect(draftCl.status).toBe(200);
      await teamJson(
        "PATCH",
        `/help-center/articles/${seeded.art1}/freshness`,
        {
          body: {
            ownerId: seeded.actorId,
            links: [{ targetKind: "changelog", targetId: draftCl.body.id }],
          },
        },
      );
      const pubCl = await teamJson("PATCH", `/changelog/${draftCl.body.id}`, {
        body: { publishState: { type: "published" } },
      });
      expect(pubCl.status).toBe(200);
      expect(pubCl.body.publishedNow).toBe(true);

      const revArt3 = await teamJson(
        "POST",
        `/help-center/articles/${seeded.art3}/mark-reviewed`,
        { body: { nextReviewDays: 90 } },
      );
      expect(revArt3.status).toBe(200);
      await withQuillsSystemWorkspace(wsId, (db) =>
        flagOverdueAndUnhelpfulArticles(db),
      );
      const queueAfterArt3 = await teamJson("GET", "/help-center/review-queue");
      expect(
        queueAfterArt3.body.items.some(
          (i: { id: string }) => i.id === seeded.art3,
        ),
      ).toBe(false);

      const queueAfterCl = await teamJson("GET", "/help-center/review-queue");
      const clFlagged = queueAfterCl.body.items.find(
        (i: { id: string }) => i.id === seeded.art1,
      );
      expect(clFlagged?.staleReason).toBe("changelog_published");
    });

    // -------------------------------------------------------------------------
    // #315: KB Hybrid Search, Click Tracking & Synonyms
    // -------------------------------------------------------------------------
    it("#315 expands synonyms, tolerates typos via pg_trgm, tracks clicks and surfaces zero-result/zero-click insights", async () => {
      const wsId = contractEnv().a;
      const synRes = await teamJson("POST", "/help-center/search-synonyms", {
        body: { term: "billing", synonyms: ["invoice", "receipt"] },
      });
      expect(synRes.status).toBe(200);

      const { artId, draftArtId } = await contractEnv().scoped(
        wsId,
        async (db, actor) => {
          const [cat] = await db
            .insert(helpCenterCategories)
            .values({
              name: "Account",
              slug: "account-search-w3",
              isPublic: true,
            })
            .returning({ id: helpCenterCategories.id });
          const [art] = await db
            .insert(helpCenterArticles)
            .values({
              categoryId: cat!.id,
              slug: "billing-download-w3",
              title: "Download Monthly Billing Statements",
              content: "Find your statements in workspace settings.",
              principalId: actor.principalId,
              publishedAt: new Date(),
            })
            .returning({ id: helpCenterArticles.id });
          const [draft] = await db
            .insert(helpCenterArticles)
            .values({
              categoryId: cat!.id,
              slug: "secret-internal-draft-w3",
              title: "Internal Draft Only",
              content: "Not published yet.",
              principalId: actor.principalId,
              publishedAt: null,
            })
            .returning({ id: helpCenterArticles.id });
          return { artId: art!.id, draftArtId: draft!.id };
        },
      );

      const synSearch = await pubJson("POST", "/hc/search", {
        body: { query: "invoice", locale: "en", record: true },
      });
      expect(synSearch.status).toBe(200);
      expect(synSearch.body.queryId).toBeTruthy();
      expect(
        synSearch.body.articles.some((a: { id: string }) => a.id === artId),
      ).toBe(true);

      // Clicking an unpublished/private article must fail with 404 (no existence oracle)
      const privateClick = await pubJson(
        "POST",
        `/hc/search/${synSearch.body.queryId}/click`,
        { body: { articleId: draftArtId } },
      );
      expect(privateClick.status).toBe(404);

      const clickRes = await pubJson(
        "POST",
        `/hc/search/${synSearch.body.queryId}/click`,
        { body: { articleId: artId } },
      );
      expect(clickRes.status).toBe(200);
      expect(clickRes.body.recorded).toBe(true);

      const typoSearch = await pubJson("POST", "/hc/search", {
        body: { query: "Statemnts", locale: "en", record: true },
      });
      expect(typoSearch.status).toBe(200);
      expect(
        typoSearch.body.articles.some((a: { id: string }) => a.id === artId),
      ).toBe(true);

      const zeroSearch = await pubJson("POST", "/hc/search", {
        body: { query: "zxqvbnm_nonexistent_term", locale: "en", record: true },
      });
      expect(zeroSearch.status).toBe(200);
      expect(zeroSearch.body.articles).toHaveLength(0);

      const insightsRes = await teamJson(
        "GET",
        "/help-center/search-insights?days=30",
      );
      expect(insightsRes.status).toBe(200);
      expect(insightsRes.body.totalSearches).toBeGreaterThanOrEqual(3);
      expect(insightsRes.body.clickedCount).toBeGreaterThanOrEqual(1);
      expect(insightsRes.body.clickThroughRate).toBeGreaterThan(0);
      expect(
        insightsRes.body.zeroResultQueries.some(
          (q: { query: string }) => q.query === "zxqvbnm_nonexistent_term",
        ),
      ).toBe(true);
      expect(
        insightsRes.body.zeroClickQueries.some(
          (q: { query: string }) => q.query === "Statemnts",
        ),
      ).toBe(true);
    });

    // -------------------------------------------------------------------------
    // #304: Feedback Hygiene, Fair Vote Weighting & Burst Detection
    // -------------------------------------------------------------------------
    it("#304 prevents single-company brigading with fair weighting, detects vote bursts, finds similar posts without AI, and gates revenue", async () => {
      const wsId = contractEnv().a;
      const brigaded = computeFairDemandScore(
        Array.from({ length: 10 }, (_, i) => ({
          principalId: `p_${i}`,
          companyId: "comp_big",
          mrrCents: 10000,
          churnRisk: false,
          importance: null,
        })),
      );
      const broad = computeFairDemandScore(
        Array.from({ length: 5 }, (_, i) => ({
          principalId: `q_${i}`,
          companyId: `comp_${i}`,
          mrrCents: 1000,
          churnRisk: false,
          importance: null,
        })),
      );
      expect(broad.fairScore).toBeGreaterThan(brigaded.fairScore);

      const seeded = await contractEnv().scoped(wsId, async (db, actor) => {
        const [board] = await db
          .insert(boards)
          .values({ name: "Ideas W3", slug: "ideas-hygiene-w3" })
          .returning({ id: boards.id });
        const [status] = await db
          .select({ id: postStatuses.id })
          .from(postStatuses)
          .where(eq(postStatuses.category, "active"))
          .limit(1);
        const [comp] = await db
          .insert(companies)
          .values({
            name: "AtRisk Corp W3",
            mrrCents: 99900,
            churnRisk: true,
            source: "manual",
          })
          .returning({ id: companies.id });
        const [postA] = await db
          .insert(posts)
          .values({
            boardId: board!.id,
            title: "Dark mode for billing dashboard",
            content: "Please add dark theme support across charts.",
            principalId: actor.principalId,
            statusId: status!.id,
          })
          .returning({ id: posts.id });

        const voterIds: string[] = [];
        for (let i = 0; i < 10; i++) {
          const [vp] = await db
            .insert(principal)
            .values({
              type: "customer",
              displayName: `Burst Voter ${i}`,
              companyId: i === 0 ? comp!.id : null,
              createdAt: new Date(),
            })
            .returning({ id: principal.id });
          voterIds.push(vp!.id);
        }
        return { postId: postA!.id, voterIds };
      });

      for (const voterId of seeded.voterIds) {
        const vRes = await teamJson(
          "PUT",
          `/posts/${seeded.postId}/voters/${voterId}`,
        );
        expect(vRes.status).toBe(200);
      }

      const simRes = await teamJson(
        "GET",
        "/posts/similar?q=dark+mode+dashbord",
      );
      expect(simRes.status).toBe(200);
      expect(
        simRes.body.items.some((p: { id: string }) => p.id === seeded.postId),
      ).toBe(true);

      const hygOwner = await teamJson("GET", "/posts/hygiene");
      expect(hygOwner.status).toBe(200);
      expect(
        hygOwner.body.unacknowledged.some(
          (p: { id: string }) => p.id === seeded.postId,
        ),
      ).toBe(true);
      expect(
        hygOwner.body.burstFlagged.some(
          (p: { id: string; voteBurstCount: number }) =>
            p.id === seeded.postId && p.voteBurstCount >= 10,
        ),
      ).toBe(true);
      const rankedOwner = hygOwner.body.fairRanked.find(
        (p: { id: string }) => p.id === seeded.postId,
      );
      expect(rankedOwner?.mrrCents).toBe(99900);
      expect(rankedOwner?.churnRiskCompanies).toBe(1);

      const commentRes = await teamJson(
        "POST",
        `/posts/${seeded.postId}/comments`,
        { body: { content: "Thanks! Reviewing this now.", isPrivate: false } },
      );
      expect(commentRes.status).toBe(200);
      const hygAfterComment = await teamJson("GET", "/posts/hygiene");
      expect(
        hygAfterComment.body.unacknowledged.some(
          (p: { id: string }) => p.id === seeded.postId,
        ),
      ).toBe(false);

      // Member without quills:view_revenue sees null mrrCents (never leaks 99900)
      const { restrictedMember } =
        await import("./feedback/taxonomy-harness.fixture");
      const limitedUser = await restrictedMember(contractEnv(), [], "viewer");
      const hygReader = await teamJson("GET", "/posts/hygiene", {
        user: limitedUser,
      });
      expect(hygReader.status).toBe(200);
      const rankedReader = hygReader.body.fairRanked.find(
        (p: { id: string }) => p.id === seeded.postId,
      );
      expect(rankedReader?.mrrCents).toBeNull();
      expect(JSON.stringify(hygReader.body)).not.toContain("99900");

      await withQuillsSystemWorkspace(wsId, async (db) => {
        const [row] = await db
          .select({
            firstTeamResponseAt: posts.firstTeamResponseAt,
            voteBurstFlaggedAt: posts.voteBurstFlaggedAt,
          })
          .from(posts)
          .where(eq(posts.id, seeded.postId as never));
        expect(row?.firstTeamResponseAt).not.toBeNull();
        expect(row?.voteBurstFlaggedAt).not.toBeNull();
      });
    });
  },
);
