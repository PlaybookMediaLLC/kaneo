import { and, asc, eq, isNull } from "drizzle-orm";
import type { KbArticleId, KbCategoryId } from "@kaneo/ids";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import {
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterCategories,
  helpCenterCategoryTranslations,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../framework/define-route";
import { articleParams } from "./articles";
import { categoryParams, requireCategory } from "./categories";
import { locale, notFound, readConfig, type Db } from "./shared";

// Default-locale text stays on the article or category; translations are separate rows, so a
// translation never changes the base row or its public URL ID. As in the source, any supported
// locale is accepted, and the statuses list the enabled additional locales.

const articleTranslation = z
  .object({
    id: z.string(),
    locale: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    content: z.string(),
    status: z.enum(["draft", "published"]).openapi({
      description:
        "Independent of the article's own state. Public reads show published translations only.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsHelpCenterArticleTranslation");
const categoryTranslation = z
  .object({
    id: z.string(),
    locale: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsHelpCenterCategoryTranslation");
const articleColumns = {
  id: helpCenterArticleTranslations.id,
  locale: helpCenterArticleTranslations.locale,
  title: helpCenterArticleTranslations.title,
  description: helpCenterArticleTranslations.description,
  content: helpCenterArticleTranslations.content,
  status: helpCenterArticleTranslations.status,
  createdAt: helpCenterArticleTranslations.createdAt,
  updatedAt: helpCenterArticleTranslations.updatedAt,
};
const categoryColumns = {
  id: helpCenterCategoryTranslations.id,
  locale: helpCenterCategoryTranslations.locale,
  name: helpCenterCategoryTranslations.name,
  description: helpCenterCategoryTranslations.description,
  createdAt: helpCenterCategoryTranslations.createdAt,
  updatedAt: helpCenterCategoryTranslations.updatedAt,
};
const byLocale = z.object({ locale });
const statusEntry = <S extends z.ZodType>(status: S) =>
  z.object({
    locale: z.string(),
    status,
    updatedAt: nullableResponseTimestamp,
  });

/** A live article, locked against a concurrent delete. */
async function requireArticle(db: Db, id: KbArticleId) {
  const [row] = await db
    .select({ id: helpCenterArticles.id })
    .from(helpCenterArticles)
    .where(
      and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt)),
    )
    .for("no key update");
  if (!row) throw notFound("Article");
}

const articleTranslationOf = (id: KbArticleId, value: string) =>
  and(
    eq(helpCenterArticleTranslations.articleId, id),
    eq(helpCenterArticleTranslations.locale, value),
  );
const categoryTranslationOf = (id: KbCategoryId, value: string) =>
  and(
    eq(helpCenterCategoryTranslations.categoryId, id),
    eq(helpCenterCategoryTranslations.locale, value),
  );

const listArticleTranslations = defineQuillsRoute({
  method: "get",
  path: "/help-center/articles/{articleId}/translations",
  operationId: "listQuillsHelpCenterArticleTranslations",
  summary: "List an article's translations and a status per enabled locale",
  action: "read",
  params: articleParams,
  response: z.object({
    translations: z.array(articleTranslation),
    statuses: z.array(
      statusEntry(z.enum(["draft", "published", "untranslated"])),
    ),
  }),
  responseDescription: "Translations and locale statuses",
  errors: { 404: "Article not found" },
  handler: async ({ db, params: { articleId } }) => {
    const [found] = await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(
        and(
          eq(helpCenterArticles.id, articleId),
          isNull(helpCenterArticles.deletedAt),
        ),
      );
    if (!found) throw notFound("Article");
    const translations = await db
      .select(articleColumns)
      .from(helpCenterArticleTranslations)
      .where(eq(helpCenterArticleTranslations.articleId, articleId))
      .orderBy(asc(helpCenterArticleTranslations.locale));
    const { locales } = await readConfig(db);
    return {
      translations,
      statuses: locales.additional.map((code) => {
        const row = translations.find((t) => t.locale === code);
        return {
          locale: code,
          status: row?.status ?? ("untranslated" as const),
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    };
  },
});

const saveArticleTranslation = defineQuillsRoute({
  method: "put",
  path: "/help-center/articles/{articleId}/translations",
  operationId: "saveQuillsHelpCenterArticleTranslation",
  summary: "Create or replace an article translation",
  description:
    "A new translation starts as a draft; saving keeps the current status. The article and its URL ID do not change.",
  action: "update",
  params: articleParams,
  body: z.object({
    locale,
    title: z.string().trim().max(200),
    description: z.string().trim().max(300).nullable().optional(),
    content: z.string().max(100000),
  }),
  response: articleTranslation,
  responseDescription: "The saved translation",
  errors: { 404: "Article not found" },
  event: ({ params }, result) => ({
    type: "help_center.article_translation_saved",
    entityType: "article",
    entityId: params.articleId,
    payload: { locale: result.locale },
  }),
  handler: async ({ db, params: { articleId }, body }) => {
    await requireArticle(db, articleId);
    const text = {
      title: body.title,
      description: body.description || null,
      content: body.content,
      // An imported rich body would otherwise outlive the new text.
      contentJson: null,
    };
    const [row] = await db
      .insert(helpCenterArticleTranslations)
      .values({ articleId, locale: body.locale, ...text })
      .onConflictDoUpdate({
        target: [
          helpCenterArticleTranslations.workspaceId,
          helpCenterArticleTranslations.articleId,
          helpCenterArticleTranslations.locale,
        ],
        set: { ...text, updatedAt: new Date() },
      })
      .returning(articleColumns);
    return row!;
  },
});

const setArticleTranslationStatus = defineQuillsRoute({
  method: "put",
  path: "/help-center/articles/{articleId}/translations/status",
  operationId: "setQuillsHelpCenterArticleTranslationStatus",
  summary: "Publish or unpublish an article translation",
  action: "update",
  params: articleParams,
  body: z.object({ locale, status: z.enum(["draft", "published"]) }),
  response: articleTranslation,
  responseDescription: "The translation",
  errors: { 404: "Article or translation not found" },
  event: ({ params }, result) => ({
    type: "help_center.article_translation_status_changed",
    entityType: "article",
    entityId: params.articleId,
    payload: { locale: result.locale, status: result.status },
  }),
  handler: async ({ db, params: { articleId }, body }) => {
    await requireArticle(db, articleId);
    const [row] = await db
      .update(helpCenterArticleTranslations)
      .set({ status: body.status, updatedAt: new Date() })
      .where(articleTranslationOf(articleId, body.locale))
      .returning(articleColumns);
    if (!row) throw notFound("Translation");
    return row;
  },
});

const deleteArticleTranslation = defineQuillsRoute({
  method: "delete",
  path: "/help-center/articles/{articleId}/translations",
  operationId: "deleteQuillsHelpCenterArticleTranslation",
  summary: "Delete an article translation",
  action: "delete",
  params: articleParams,
  query: byLocale,
  response: z.object({ id: z.string(), locale: z.string() }),
  responseDescription: "The deleted translation",
  errors: { 404: "Article or translation not found" },
  event: ({ params, query }) => ({
    type: "help_center.article_translation_deleted",
    entityType: "article",
    entityId: params.articleId,
    payload: { locale: query.locale },
  }),
  handler: async ({ db, params: { articleId }, query }) => {
    await requireArticle(db, articleId);
    const [row] = await db
      .delete(helpCenterArticleTranslations)
      .where(articleTranslationOf(articleId, query.locale))
      .returning({
        id: helpCenterArticleTranslations.id,
        locale: helpCenterArticleTranslations.locale,
      });
    if (!row) throw notFound("Translation");
    return row;
  },
});

const listCategoryTranslations = defineQuillsRoute({
  method: "get",
  path: "/help-center/categories/{categoryId}/translations",
  operationId: "listQuillsHelpCenterCategoryTranslations",
  summary: "List a category's translations and a status per enabled locale",
  description:
    "A category counts as translated when its translated name is not empty.",
  action: "read",
  params: categoryParams,
  response: z.object({
    translations: z.array(categoryTranslation),
    statuses: z.array(statusEntry(z.enum(["translated", "untranslated"]))),
  }),
  responseDescription: "Translations and locale statuses",
  errors: { 404: "Category not found" },
  handler: async ({ db, params: { categoryId } }) => {
    const [found] = await db
      .select({ id: helpCenterCategories.id })
      .from(helpCenterCategories)
      .where(
        and(
          eq(helpCenterCategories.id, categoryId),
          isNull(helpCenterCategories.deletedAt),
        ),
      );
    if (!found) throw notFound("Category");
    const translations = await db
      .select(categoryColumns)
      .from(helpCenterCategoryTranslations)
      .where(eq(helpCenterCategoryTranslations.categoryId, categoryId))
      .orderBy(asc(helpCenterCategoryTranslations.locale));
    const { locales } = await readConfig(db);
    return {
      translations,
      statuses: locales.additional.map((code) => {
        const row = translations.find((t) => t.locale === code);
        return {
          locale: code,
          status: row?.name.trim()
            ? ("translated" as const)
            : ("untranslated" as const),
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    };
  },
});

const saveCategoryTranslation = defineQuillsRoute({
  method: "put",
  path: "/help-center/categories/{categoryId}/translations",
  operationId: "saveQuillsHelpCenterCategoryTranslation",
  summary: "Create or replace a category translation",
  action: "manage_settings",
  params: categoryParams,
  body: z.object({
    locale,
    name: z.string().trim().max(200),
    description: z.string().trim().max(2000).nullable().optional(),
  }),
  response: categoryTranslation,
  responseDescription: "The saved translation",
  errors: { 404: "Category not found" },
  event: ({ params }, result) => ({
    type: "help_center.category_translation_saved",
    entityType: "help_center_category",
    entityId: params.categoryId,
    payload: { locale: result.locale },
  }),
  handler: async ({ db, params: { categoryId }, body }) => {
    await requireCategory(db, categoryId);
    const text = { name: body.name, description: body.description || null };
    const [row] = await db
      .insert(helpCenterCategoryTranslations)
      .values({ categoryId, locale: body.locale, ...text })
      .onConflictDoUpdate({
        target: [
          helpCenterCategoryTranslations.workspaceId,
          helpCenterCategoryTranslations.categoryId,
          helpCenterCategoryTranslations.locale,
        ],
        set: { ...text, updatedAt: new Date() },
      })
      .returning(categoryColumns);
    return row!;
  },
});

const deleteCategoryTranslation = defineQuillsRoute({
  method: "delete",
  path: "/help-center/categories/{categoryId}/translations",
  operationId: "deleteQuillsHelpCenterCategoryTranslation",
  summary: "Delete a category translation",
  action: "manage_settings",
  params: categoryParams,
  query: byLocale,
  response: z.object({ id: z.string(), locale: z.string() }),
  responseDescription: "The deleted translation",
  errors: { 404: "Category or translation not found" },
  event: ({ params, query }) => ({
    type: "help_center.category_translation_deleted",
    entityType: "help_center_category",
    entityId: params.categoryId,
    payload: { locale: query.locale },
  }),
  handler: async ({ db, params: { categoryId }, query }) => {
    await requireCategory(db, categoryId);
    const [row] = await db
      .delete(helpCenterCategoryTranslations)
      .where(categoryTranslationOf(categoryId, query.locale))
      .returning({
        id: helpCenterCategoryTranslations.id,
        locale: helpCenterCategoryTranslations.locale,
      });
    if (!row) throw notFound("Translation");
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listArticleTranslations)
  .openapi(...saveArticleTranslation)
  .openapi(...setArticleTranslationStatus)
  .openapi(...deleteArticleTranslation)
  .openapi(...listCategoryTranslations)
  .openapi(...saveCategoryTranslation)
  .openapi(...deleteCategoryTranslation);
