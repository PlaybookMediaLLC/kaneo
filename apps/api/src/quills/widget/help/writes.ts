import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../openapi";
import { defineQuillsRoute } from "../../framework/define-route";
import {
  searchArticles,
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

// Widget help writes: the visitor's article vote and the knowledge-base search, which records
// a search-term row. The AI answer route (kb-ask) belongs to P8.

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
    "Keyword search over public articles. A locale that is not enabled searches the default locale.",
  action: "read",
  body: searchBody,
  response: z.object({ locale: z.string(), articles: z.array(searchHit) }),
  responseDescription: "Matching articles, best first",
  errors: { 404: "Help center not found" },
  event: searchEvent,
  handler: async ({ db, caller, body }) => {
    const viewer = await openHelpCenter(db, caller, "widget", body.locale, {
      fallback: true,
    });
    return {
      locale: viewer.locale,
      articles: await searchArticles(db, viewer, body.query, body.limit),
    };
  },
});

export default apiRouter()
  .openapi(...feedback)
  .openapi(...search);
