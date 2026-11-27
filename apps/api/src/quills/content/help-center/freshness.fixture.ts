import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../../database/quills/schema/kb";
import { fixture, type ContractEnv } from "../../framework/contract";

async function seedArticle(env: ContractEnv, workspaceId: string) {
  return env.scoped(workspaceId, async (db, actor) => {
    const [category] = await db
      .insert(helpCenterCategories)
      .values({
        name: "Guides",
        slug: env.id("cat"),
        isPublic: true,
      })
      .returning({ id: helpCenterCategories.id });
    const [article] = await db
      .insert(helpCenterArticles)
      .values({
        categoryId: category!.id,
        slug: env.id("art"),
        title: "Freshness Contract Article",
        content: "Original docs",
        principalId: actor.principalId,
        publishedAt: new Date(),
      })
      .returning({ id: helpCenterArticles.id });
    return { articleId: article!.id, actorPrincipalId: actor.principalId };
  });
}

export const listQuillsHelpCenterReviewQueue = fixture({
  seed: async (env) => seedArticle(env, env.a),
  valid: () => ({}),
});

export const updateQuillsHelpCenterArticleFreshness = fixture({
  seed: async (env) => ({
    a: await seedArticle(env, env.a),
    b: await seedArticle(env, env.b),
  }),
  valid: (s) => ({
    params: { articleId: s.a.articleId },
    body: {
      ownerId: s.a.actorPrincipalId,
      reviewBy: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      links: [
        { targetKind: "url" as const, targetId: "https://example.com/docs" },
      ],
    },
  }),
  foreign: (s) => ({
    articleId: s.b.articleId,
    ownerId: s.b.actorPrincipalId,
  }),
});

export const markQuillsHelpCenterArticleReviewed = fixture({
  seed: async (env) => ({
    a: await seedArticle(env, env.a),
    b: await seedArticle(env, env.b),
  }),
  valid: (s) => ({
    params: { articleId: s.a.articleId },
    body: { nextReviewDays: 60 },
  }),
  foreign: (s) => ({ articleId: s.b.articleId }),
});

export const flagQuillsHelpCenterArticleStale = fixture({
  seed: async (env) => ({
    a: await seedArticle(env, env.a),
    b: await seedArticle(env, env.b),
  }),
  valid: (s) => ({
    params: { articleId: s.a.articleId },
    body: { reason: "manual" as const, details: "Screenshots outdated" },
  }),
  foreign: (s) => ({ articleId: s.b.articleId }),
});
