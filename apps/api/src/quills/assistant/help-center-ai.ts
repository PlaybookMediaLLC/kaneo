import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { helpCenterArticles } from "../../database/quills/schema/kb";
import { defineQuillsRoute } from "../framework/define-route";
import {
  DEFAULT_LOCALE,
  locale,
  readConfig,
} from "../content/help-center/shared";
import { exactDistance } from "./engine/distance";
import { embed, requireAi, requireEmbeddings, toHttp } from "./provider";
import { logUsage } from "./runs";

// AI features of the help center. Auto-translation is a request that a worker runs after commit;
// it also runs for help_center.article_published when the publish recorded autoTranslate.
// Semantic search embeds the query in `load`, before the transaction, and logs the usage.

const translate = defineQuillsRoute({
  method: "post",
  path: "/help-center/articles/{articleId}/auto-translate",
  operationId: "requestQuillsArticleTranslation",
  summary: "Translate a help-center article with AI",
  description:
    "A worker writes the translation as a draft after commit (an existing translation keeps its status). The locale must be one of the help center's additional locales. 409 when AI is not configured.",
  action: "update",
  params: z.object({ articleId: flexibleToTypeIdSchema("article") }),
  body: z.object({ locale }),
  load: async () => {
    requireAi();
  },
  response: z.object({ requested: z.literal(true) }),
  responseDescription: "The request was recorded",
  errors: {
    404: "Article not found",
    409: "AI is not configured, or the locale is not enabled",
  },
  event: ({ params, body }) => ({
    type: "help_center.article_translation_requested",
    entityType: "article",
    entityId: params.articleId,
    payload: { locale: body.locale },
  }),
  handler: async ({ db, params, body }) => {
    const [article] = await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(
        and(
          eq(helpCenterArticles.id, params.articleId),
          isNull(helpCenterArticles.deletedAt),
        ),
      );
    if (!article)
      throw new HTTPException(404, { message: "Article not found" });
    const config = await readConfig(db);
    if (
      body.locale === (config.locales.default || DEFAULT_LOCALE) ||
      !config.locales.additional.includes(body.locale)
    )
      throw new HTTPException(409, {
        message: "Enable this locale in the help-center settings first",
      });
    return { requested: true as const };
  },
});

const search = defineQuillsRoute({
  method: "post",
  path: "/help-center/semantic-search",
  operationId: "searchQuillsHelpCenterSemantic",
  summary: "Search help-center articles by meaning",
  description:
    "Embeds the query and ranks articles that have an embedding by cosine similarity. Drafts are included and marked. 409 when no embedding model is configured.",
  action: "read",
  body: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  load: async ({ body }) => {
    requireEmbeddings();
    return embed([body.query]).catch((error) => {
      throw toHttp(error);
    });
  },
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        published: z.boolean(),
        score: z.number(),
      }),
    ),
  }),
  responseDescription: "Articles, most similar first",
  errors: { 409: "AI embeddings are not configured" },
  event: {
    none: "A search changes no domain data; the usage log row is its record",
  },
  handler: async ({ db, body, loaded }) => {
    await logUsage(db, [
      {
        step: "help_center_search",
        callType: "embedding",
        usage: loaded.usage,
      },
    ]);
    const vector = sql`${JSON.stringify(loaded.vectors[0])}::vector`;
    const distance = exactDistance(helpCenterArticles.embedding, vector);
    return {
      items: await db
        .select({
          id: helpCenterArticles.id,
          title: helpCenterArticles.title,
          published: sql<boolean>`${helpCenterArticles.publishedAt} IS NOT NULL`,
          score: sql<number>`(1 - ${distance})::float8`,
        })
        .from(helpCenterArticles)
        .where(
          and(
            isNull(helpCenterArticles.deletedAt),
            isNotNull(helpCenterArticles.embedding),
          ),
        )
        .orderBy(distance)
        .limit(body.limit),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...translate)
  .openapi(...search);
