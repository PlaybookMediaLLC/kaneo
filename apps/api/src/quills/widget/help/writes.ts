import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../openapi";
import { defineQuillsRoute } from "../../framework/define-route";
import {
  recordSearchClick,
  searchArticlesWithMeta,
  searchBody,
  searchEvent,
  searchHit,
  searchRateLimit,
} from "../../content/public/help-center/search";
import { openHelpCenter } from "../../content/public/help-center/visibility";
import {
  recordVote,
  voteEvent,
  voteResult,
} from "../../content/public/help-center/votes";

// Widget help writes: the visitor's article vote, hybrid knowledge-base search and click tracking.

const feedback = defineQuillsRoute({
  audience: "widget",
  rateLimit: { limit: 30, windowSeconds: 600 },
  method: "put",
  path: "/widget/help/articles/{articleId}/feedback",
  operationId: "setQuillsWidgetHelpArticleFeedback",
  summary: "Set the widget visitor's helpful or not-helpful vote on an article",
  description:
    "Desired state: one vote per identified visitor, and a repeated vote changes nothing. Needs a widget session.",
  action: "update",
  params: z.object({ articleId: flexibleToTypeIdSchema("article") }),
  body: z.object({ helpful: z.boolean() }),
  response: voteResult,
  responseDescription: "The visitor's vote",
  errors: { 404: "Help center or article not found", 409: "A concurrent vote" },
  event: voteEvent,
  handler: async ({ db, caller, params, body }) =>
    recordVote(
      db,
      await openHelpCenter(db, caller, "widget", undefined),
      params.articleId,
      caller.principalId,
      body.helpful,
    ),
});

const search = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  rateLimit: searchRateLimit,
  method: "post",
  path: "/widget/kb-search",
  operationId: "searchQuillsWidgetHelp",
  summary: "Search help articles from the widget",
  description:
    "Hybrid search (FTS, prefix, pg_trgm typo tolerance and synonyms) over public articles. Returns queryId for click-through tracking.",
  action: "read",
  body: searchBody,
  response: z.object({
    locale: z.string(),
    queryId: z.string().nullable(),
    articles: z.array(searchHit),
  }),
  responseDescription: "Matching articles, best first",
  errors: { 404: "Help center not found" },
  event: searchEvent,
  handler: async ({ db, caller, body }) => {
    const viewer = await openHelpCenter(db, caller, "widget", body.locale, {
      fallback: true,
    });
    const result = await searchArticlesWithMeta(
      db,
      viewer,
      body.query,
      body.limit,
      body.record,
    );
    return {
      locale: viewer.locale,
      queryId: result.queryId,
      articles: result.articles,
    };
  },
});

const searchClick = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  rateLimit: searchRateLimit,
  method: "post",
  path: "/widget/kb-search/{queryId}/click",
  operationId: "recordQuillsWidgetHelpSearchClick",
  summary: "Record which article a widget visitor clicked from search results",
  action: "update",
  params: z.object({ queryId: z.uuid() }),
  body: z.object({ articleId: flexibleToTypeIdSchema("article") }),
  response: z.object({ recorded: z.literal(true) }),
  responseDescription: "Click recorded",
  errors: { 404: "Help center, search query or article not found" },
  event: { none: "Click-through analytics update on kb_search_queries" },
  handler: async ({ db, caller, params, body }) => {
    const viewer = await openHelpCenter(db, caller, "widget", undefined, {
      fallback: true,
    });
    return recordSearchClick(db, viewer, params.queryId, body.articleId);
  },
});

export default apiRouter()
  .openapi(...feedback)
  .openapi(...search)
  .openapi(...searchClick);
