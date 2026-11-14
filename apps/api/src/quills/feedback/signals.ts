import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostId, TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { conversations } from "../../database/quills/schema/conversation";
import { feedbackSignals } from "../../database/quills/schema/feedback-signals";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { tickets } from "../../database/quills/schema/tickets";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../framework/define-route";
import { recordActivity } from "./activity";
import { insertPost } from "./posts";
import { page, pageQuery } from "./schemas";
import { addVote } from "./votes";
import { loadProjects, notFound, notTest, visiblePost } from "./visibility";

// Feedback autopilot (RFC 0003 feature 1): the review queue of the signals that
// jobs/handlers/signals.ts found in closed conversations and resolved tickets.
// `quills:read` sees every conversation and ticket of the workspace (support D2), so a signal is
// readable while its ticket is live and its customer is not a test customer. A matched or
// resulting post shows only when its board is visible to the caller.

const STATUSES = ["pending", "accepted", "dismissed"] as const;
const params = z.object({
  signalId: flexibleToTypeIdSchema("feedback_signal"),
});
const conflict = (message: string) => new HTTPException(409, { message });

/** The source rule above, as one condition on `feedback_signals`. */
export const readable = and(
  notTest(feedbackSignals.principalId),
  or(
    isNull(feedbackSignals.ticketId),
    sql`exists (select 1 from ${tickets} where ${and(eq(tickets.id, feedbackSignals.ticketId), isNull(tickets.deletedAt))})`,
  ),
)!;

const postSummary = z.object({
  id: z.string(),
  title: z.string(),
  voteCount: z.number(),
  boardName: z.string(),
  statusName: z.string().nullable(),
});
const signalSchema = z.object({
  id: z.string(),
  status: z.enum(STATUSES),
  source: z.object({
    type: z.enum(["conversation", "ticket"]),
    id: z.string(),
    /** The conversation subject or the ticket title. */
    title: z.string().nullable(),
    /** The ticket number. Null for a conversation. */
    number: z.number().nullable(),
  }),
  customer: z.object({
    principalId: z.string(),
    displayName: z.string().nullable(),
  }),
  excerpt: z.string(),
  suggestedTitle: z.string(),
  matchedPost: postSummary.nullable(),
  resultingPost: postSummary.nullable(),
  createdAt: responseTimestamp,
  decidedAt: nullableResponseTimestamp,
});
const decision = z.object({
  id: z.string(),
  status: z.enum(STATUSES),
  resultingPostId: z.string().nullable(),
});

/** Post summaries by ID, only for posts that the caller can see. */
async function visiblePosts(db: Database, ids: PostId[], projects: string[]) {
  const rows = ids.length
    ? await db
        .select({
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          boardName: boards.name,
          statusName: postStatuses.name,
        })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .where(and(inArray(posts.id, ids), visiblePost(projects)))
    : [];
  return new Map(rows.map((row) => [row.id, row]));
}

const list = defineQuillsRoute({
  method: "get",
  path: "/feedback-signals",
  operationId: "listQuillsFeedbackSignals",
  summary: "List the feedback signals",
  description:
    "Feature requests and bug reports that the autopilot found in closed conversations and resolved tickets, newest first. A signal of a deleted ticket or a test customer is left out. A matched or resulting post is null when its board is not visible to you.",
  action: "read",
  query: z.object({
    status: z.enum(STATUSES).default("pending"),
    source: z.enum(["conversation", "ticket"]).optional(),
    ...pageQuery,
  }),
  load: loadProjects,
  response: z.object({
    items: z.array(signalSchema),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of signals",
  handler: async ({ db, query, loaded }) => {
    const rows = await db
      .select({
        id: feedbackSignals.id,
        status: feedbackSignals.status,
        conversationId: feedbackSignals.conversationId,
        ticketId: feedbackSignals.ticketId,
        subject: conversations.subject,
        ticketTitle: tickets.title,
        ticketNumber: tickets.number,
        principalId: principal.id,
        principalType: principal.type,
        displayName: principal.displayName,
        excerpt: feedbackSignals.excerpt,
        suggestedTitle: feedbackSignals.suggestedTitle,
        matchedPostId: feedbackSignals.matchedPostId,
        resultingPostId: feedbackSignals.resultingPostId,
        createdAt: feedbackSignals.createdAt,
        decidedAt: feedbackSignals.decidedAt,
      })
      .from(feedbackSignals)
      .innerJoin(principal, eq(principal.id, feedbackSignals.principalId))
      .leftJoin(
        conversations,
        eq(conversations.id, feedbackSignals.conversationId),
      )
      .leftJoin(tickets, eq(tickets.id, feedbackSignals.ticketId))
      .where(
        and(
          eq(feedbackSignals.status, query.status),
          query.source === "conversation"
            ? isNotNull(feedbackSignals.conversationId)
            : query.source === "ticket"
              ? isNotNull(feedbackSignals.ticketId)
              : undefined,
          readable,
        ),
      )
      .orderBy(desc(feedbackSignals.createdAt), desc(feedbackSignals.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    const result = page(rows, query);
    const summaries = await visiblePosts(
      db,
      result.items.flatMap((row) =>
        [row.matchedPostId, row.resultingPostId].filter(
          (id): id is PostId => id !== null,
        ),
      ),
      loaded,
    );
    return {
      ...result,
      items: result.items.map((row) => ({
        id: row.id,
        status: row.status,
        source: row.conversationId
          ? {
              type: "conversation" as const,
              id: row.conversationId,
              title: row.subject,
              number: null,
            }
          : {
              type: "ticket" as const,
              id: row.ticketId!,
              title: row.ticketTitle,
              number: row.ticketNumber,
            },
        customer: {
          principalId: row.principalId,
          displayName:
            row.principalType === "anonymous" ? null : row.displayName,
        },
        excerpt: row.excerpt,
        suggestedTitle: row.suggestedTitle,
        matchedPost:
          (row.matchedPostId && summaries.get(row.matchedPostId)) || null,
        resultingPost:
          (row.resultingPostId && summaries.get(row.resultingPostId)) || null,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt,
      })),
    };
  },
});

/** A readable signal, locked for a decision. 404 otherwise. */
async function lockSignal(db: Database, id: TypeId<"feedback_signal">) {
  const [row] = await db
    .select()
    .from(feedbackSignals)
    .where(and(eq(feedbackSignals.id, id), readable))
    .for("update");
  if (!row) throw notFound("Signal");
  return row;
}
async function pendingSignal(db: Database, id: TypeId<"feedback_signal">) {
  const row = await lockSignal(db, id);
  if (row.status !== "pending") throw conflict("This signal is not pending");
  return row;
}
async function accept(
  db: Database,
  actor: QuillsActor,
  id: TypeId<"feedback_signal">,
  postId: PostId,
) {
  await db
    .update(feedbackSignals)
    .set({
      status: "accepted",
      decidedAt: new Date(),
      decidedByPrincipalId: actor.principalId,
      resultingPostId: postId,
    })
    .where(eq(feedbackSignals.id, id));
  return { id, status: "accepted" as const, resultingPostId: postId };
}
const accepted = (id: string, postId: string, mode: "post" | "vote") => ({
  type: "signal.accepted" as const,
  entityType: "feedback_signal" as const,
  entityId: id,
  payload: { postId, mode },
});
const decisionErrors = {
  404: "Signal, board or post not found",
  409: "The signal is not pending",
};

const acceptAsPost = defineQuillsRoute({
  method: "post",
  path: "/feedback-signals/{signalId}/post",
  operationId: "acceptQuillsFeedbackSignalAsPost",
  summary: "Accept a signal as a new post",
  description:
    "Creates a post on a board that you can see, as createQuillsPost does: the customer is its author and first voter, you are the teammate who tracks it, and the excerpt is its content. The post and the decision commit together. 409 when the signal is not pending.",
  action: "create",
  params,
  body: z.object({
    boardId: flexibleToTypeIdSchema("board"),
    title: z.string().trim().min(1).max(200),
  }),
  load: loadProjects,
  response: decision,
  responseDescription: "The accepted signal and its new post",
  errors: decisionErrors,
  event: ({ body }, result) => [
    {
      type: "post.created",
      entityType: "post",
      entityId: result.resultingPostId!,
      payload: { boardId: body.boardId },
    },
    accepted(result.id, result.resultingPostId!, "post"),
  ],
  handler: async ({ db, actor, params, body, loaded }) => {
    const signal = await pendingSignal(db, params.signalId);
    const postId = await insertPost(db, actor, loaded, {
      boardId: body.boardId,
      title: body.title,
      content: signal.excerpt,
      tagIds: [],
      author: signal.principalId,
    });
    return accept(db, actor, signal.id, postId);
  },
});

const acceptAsVote = defineQuillsRoute({
  method: "post",
  path: "/feedback-signals/{signalId}/vote",
  operationId: "acceptQuillsFeedbackSignalAsVote",
  summary: "Accept a signal as a vote on a post",
  description:
    "Adds the customer's vote to a post that you can see, usually the matched post, as addQuillsPostProxyVote does: a merged post's vote counts on the post it was merged into, and a vote that exists already is kept (`voteAdded` false). The vote and the decision commit together. 409 when the signal is not pending.",
  action: "create",
  params,
  body: z.object({ postId: flexibleToTypeIdSchema("post") }),
  load: loadProjects,
  response: decision.extend({
    voteAdded: z.boolean(),
    voterPrincipalId: z.string(),
  }),
  responseDescription: "The accepted signal and the post that holds the vote",
  errors: decisionErrors,
  event: (_input, result) => [
    ...(result.voteAdded
      ? [
          {
            type: "post.voted" as const,
            entityType: "post" as const,
            entityId: result.resultingPostId!,
            payload: { principalId: result.voterPrincipalId },
          },
        ]
      : []),
    accepted(result.id, result.resultingPostId!, "vote"),
  ],
  handler: async ({ db, actor, params, body, loaded }) => {
    const signal = await pendingSignal(db, params.signalId);
    const vote = await addVote(
      db,
      body.postId,
      loaded,
      signal.principalId,
      actor,
    );
    if (vote.changed) {
      const [voter] = await db
        .select({ name: principal.displayName })
        .from(principal)
        .where(eq(principal.id, signal.principalId));
      await recordActivity(db, actor, vote.postId, {
        type: "vote.proxy",
        metadata: {
          voterPrincipalId: signal.principalId,
          voterName: voter?.name ?? null,
        },
      });
    }
    return {
      ...(await accept(db, actor, signal.id, vote.postId)),
      voteAdded: vote.changed,
      voterPrincipalId: signal.principalId,
    };
  },
});

const review = (to: "dismissed" | "pending") =>
  defineQuillsRoute({
    method: "post",
    path:
      to === "dismissed"
        ? "/feedback-signals/{signalId}/dismiss"
        : "/feedback-signals/{signalId}/restore",
    operationId:
      to === "dismissed"
        ? "dismissQuillsFeedbackSignal"
        : "restoreQuillsFeedbackSignal",
    summary:
      to === "dismissed"
        ? "Dismiss a feedback signal"
        : "Restore a dismissed feedback signal",
    description:
      to === "dismissed"
        ? "Only a pending signal. 409 otherwise."
        : "Puts a dismissed signal back in the pending queue. 409 for a signal that is not dismissed.",
    action: "update",
    params,
    response: decision,
    responseDescription: "The signal's new status",
    errors: {
      404: "Signal not found",
      409: "The signal is not in the right status",
    },
    event: (_input, result) => ({
      type: to === "dismissed" ? "signal.dismissed" : "signal.restored",
      entityType: "feedback_signal",
      entityId: result.id,
    }),
    handler: async ({ db, actor, params }) => {
      const signal = await lockSignal(db, params.signalId);
      if (signal.status !== (to === "dismissed" ? "pending" : "dismissed"))
        throw conflict(
          to === "dismissed"
            ? "This signal is not pending"
            : "This signal is not dismissed",
        );
      const dismissed = to === "dismissed";
      await db
        .update(feedbackSignals)
        .set({
          status: to,
          decidedAt: dismissed ? new Date() : null,
          decidedByPrincipalId: dismissed ? actor.principalId : null,
        })
        .where(eq(feedbackSignals.id, signal.id));
      return { id: signal.id, status: to, resultingPostId: null };
    },
  });

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...list)
  .openapi(...acceptAsPost)
  .openapi(...acceptAsVote)
  .openapi(...review("dismissed"))
  .openapi(...review("pending"));
