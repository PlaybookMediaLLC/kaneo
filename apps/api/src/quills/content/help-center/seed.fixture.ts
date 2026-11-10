import { settings } from "../../../database/quills/schema/auth";
import {
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterCategories,
  helpCenterCategoryTranslations,
  helpCenterRedirectRules,
} from "../../../database/quills/schema/kb";
import type { ContractEnv } from "../../framework/contract";

// Seed helpers shared by the help-center fixtures and feature tests. Not fixtures themselves.

/** A category tree, published, draft and deleted articles, translations, a redirect and feedback in one workspace. */
export const helpCenterIn = (env: ContractEnv, workspaceId: string) =>
  env.scoped(workspaceId, async (db, actor) => {
    const category = (
      values: Partial<typeof helpCenterCategories.$inferInsert>,
    ) =>
      db
        .insert(helpCenterCategories)
        .values({ name: "Contract", slug: env.id("category"), ...values })
        .returning({
          id: helpCenterCategories.id,
          urlId: helpCenterCategories.urlId,
        })
        .then((rows) => rows[0]!);
    const article = (values: Partial<typeof helpCenterArticles.$inferInsert>) =>
      db
        .insert(helpCenterArticles)
        .values({
          categoryId: values.categoryId!,
          title: "Contract article",
          slug: env.id("article"),
          content: "Contract",
          principalId: actor.principalId,
          ...values,
        })
        .returning({
          id: helpCenterArticles.id,
          urlId: helpCenterArticles.urlId,
        })
        .then((rows) => rows[0]!);
    const parent = await category({});
    const first = await category({ parentId: parent.id });
    const second = await category({ parentId: parent.id });
    const deletedCategory = await category({ deletedAt: new Date() });
    // The counter matches the one not-helpful vote seeded below.
    const published = await article({
      categoryId: parent.id,
      publishedAt: new Date(),
      notHelpfulCount: 1,
    });
    const draft = await article({ categoryId: parent.id });
    const deletedArticle = await article({
      categoryId: parent.id,
      deletedAt: new Date(),
    });
    await db.insert(helpCenterArticleTranslations).values({
      articleId: published.id,
      locale: "de",
      title: "Vertrag",
      content: "Vertrag",
    });
    await db
      .insert(helpCenterCategoryTranslations)
      .values({ categoryId: parent.id, locale: "de", name: "Vertrag" });
    const [rule] = await db
      .insert(helpCenterRedirectRules)
      .values({
        path: `/${env.id("old")}`,
        targetType: "article",
        targetId: published.id,
      })
      .returning({ id: helpCenterRedirectRules.id });
    await db.insert(helpCenterArticleFeedback).values({
      articleId: published.id,
      principalId: actor.principalId,
      helpful: false,
      reason: "Missing a step",
    });
    return {
      categoryId: parent.id,
      categoryUrlId: parent.urlId,
      childIds: [first.id, second.id],
      deletedCategoryId: deletedCategory.id,
      articleId: published.id,
      articleUrlId: published.urlId,
      draftId: draft.id,
      deletedArticleId: deletedArticle.id,
      ruleId: rule!.id,
    };
  });

export const seed = async (env: ContractEnv) => ({
  a: await helpCenterIn(env, env.a),
  b: await helpCenterIn(env, env.b),
});
export type Ids = Awaited<ReturnType<typeof seed>>;

/** Help-center settings in A with German enabled. */
export const germanEnabled = (env: ContractEnv) =>
  env.scoped(env.a, (db) =>
    db.update(settings).set({
      helpCenterConfig: JSON.stringify({
        domain: { domain: "help.example.test", verifiedAt: null },
        locales: {
          default: "en",
          additional: ["de"],
          chrome: {
            de: {
              homepageTitle: "Hilfe",
              homepageDescription: "",
              searchPlaceholder: "Suchen",
            },
          },
        },
      }),
    }),
  );
