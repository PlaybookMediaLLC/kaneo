import { and, eq, isNull, or } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../../openapi";
import { helpCenterArticleFeedback } from "../../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../../framework/define-route";
import { notFound, openHelpCenter } from "./visibility";
import { recordVote, voteEvent, voteResult } from "./votes";

// Visitor feedback on public articles (portal audience, sign-in optional).

const vote = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  // A signed-in visitor gets a customer profile, so their vote stays one vote.
  ensureCustomer: true,
  rateLimit: { limit: 30, windowSeconds: 600 },
  method: "post",
  path: "/hc/articles/{articleId}/feedback",
  operationId: "recordQuillsPublicArticleFeedback",
  summary: "Record a visitor's helpful or not-helpful vote on a public article",
  description:
    "A signed-in visitor has one vote; a changed vote moves the counts and clears its reason. Each anonymous vote is a new vote. The counts are not public.",
  action: "create",
  params: z.object({ articleId: flexibleToTypeIdSchema("article") }),
  body: z.object({ helpful: z.boolean() }),
  response: voteResult,
  responseDescription: "The vote",
  errors: { 404: "Help center or article not found", 409: "A concurrent vote" },
  event: voteEvent,
  handler: async ({ db, caller, params, body }) =>
    recordVote(
      db,
      await openHelpCenter(db, caller, "portal", undefined),
      params.articleId,
      caller.principalId,
      body.helpful,
    ),
});

const reason = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  rateLimit: { limit: 10, windowSeconds: 600 },
  method: "post",
  path: "/hc/feedback/{feedbackId}/reason",
  operationId: "submitQuillsPublicArticleFeedbackReason",
  summary: "Add a reason to a visitor's not-helpful vote",
  description:
    "Once per vote. An anonymous vote takes a reason from whoever holds its ID; a signed-in visitor's vote only from that visitor.",
  action: "create",
  params: z.object({
    feedbackId: flexibleToTypeIdSchema("kb_article_feedback"),
  }),
  body: z.object({ reason: z.string().trim().min(1).max(1000) }),
  response: z.object({ feedbackId: z.string(), articleId: z.string() }),
  responseDescription: "The vote that took the reason",
  errors: {
    404: "Help center not found, or no not-helpful vote of the caller awaits a reason",
  },
  event: (_input, result) => ({
    type: "help_center.article_feedback_reason_added",
    entityType: "article",
    entityId: result.articleId,
  }),
  handler: async ({ db, caller, params, body }) => {
    await openHelpCenter(db, caller, "portal", undefined);
    const f = helpCenterArticleFeedback;
    // The guard is in the write, so a reason lands once and never replaces another.
    const [row] = await db
      .update(f)
      .set({ reason: body.reason })
      .where(
        and(
          eq(f.id, params.feedbackId),
          eq(f.helpful, false),
          isNull(f.reason),
          caller.principalId
            ? or(isNull(f.principalId), eq(f.principalId, caller.principalId))
            : isNull(f.principalId),
        ),
      )
      .returning({ feedbackId: f.id, articleId: f.articleId });
    if (!row) throw notFound("Vote awaiting a reason");
    return row;
  },
});

export default apiRouter()
  .openapi(...vote)
  .openapi(...reason);
