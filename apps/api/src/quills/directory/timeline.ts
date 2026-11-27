import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { conversations } from "../../database/quills/schema/conversation";
import { feedbackSignals } from "../../database/quills/schema/feedback-signals";
import { postComments, posts } from "../../database/quills/schema/posts";
import { surveyResponses, surveys } from "../../database/quills/schema/surveys";
import { tickets, ticketStatuses } from "../../database/quills/schema/tickets";
import { defineQuillsRoute } from "../framework/define-route";
import { loadCustomer } from "./customer";

// Unified cross-channel customer timeline (#309): reads conversations, tickets, feedback posts,
// comments, feedback signals, and survey responses in one chronological feed without duplicating data.

export const TIMELINE_KINDS = [
  "conversation",
  "ticket",
  "post",
  "comment",
  "signal",
  "survey",
] as const;

const timelineItemSchema = z.object({
  kind: z.enum(TIMELINE_KINDS),
  id: z.string(),
  title: z.string(),
  preview: z.string().nullable(),
  channel: z.string().nullable(),
  status: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

const getTimeline = defineQuillsRoute({
  method: "get",
  path: "/users/{principalId}/timeline",
  operationId: "getQuillsUserTimeline",
  summary: "Get a contact's unified cross-channel history",
  description:
    "Chronological feed across conversations, tickets, feedback posts, comments, signals, and survey responses without duplicating data.",
  action: "read",
  params: z.object({
    principalId: flexibleToTypeIdSchema("principal"),
  }),
  query: z.object({
    kind: z.enum(TIMELINE_KINDS).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    items: z.array(timelineItemSchema),
  }),
  responseDescription: "Chronological unified timeline items (newest first)",
  errors: { 404: "Person not found" },
  handler: async ({ db, params, query }) => {
    await loadCustomer(db, params.principalId);
    const want = (k: (typeof TIMELINE_KINDS)[number]) =>
      !query.kind || query.kind === k;
    const perSource = query.limit;

    const items: Array<{
      kind: (typeof TIMELINE_KINDS)[number];
      id: string;
      title: string;
      preview: string | null;
      channel: string | null;
      status: string | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    if (want("conversation")) {
      const rows = await db
        .select({
          id: conversations.id,
          subject: conversations.subject,
          preview: conversations.lastMessagePreview,
          channel: conversations.channel,
          status: conversations.status,
          createdAt: conversations.createdAt,
          updatedAt: conversations.lastMessageAt,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.visitorPrincipalId, params.principalId),
            isNull(conversations.mergedIntoConversationId),
          ),
        )
        .orderBy(desc(conversations.lastMessageAt))
        .limit(perSource);
      for (const r of rows) {
        items.push({
          kind: "conversation",
          id: r.id,
          title: r.subject || "Conversation",
          preview: r.preview,
          channel: r.channel,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        });
      }
    }

    if (want("ticket")) {
      const rows = await db
        .select({
          id: tickets.id,
          number: tickets.number,
          title: tickets.title,
          status: ticketStatuses.name,
          createdAt: tickets.createdAt,
          updatedAt: tickets.updatedAt,
        })
        .from(tickets)
        .leftJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
        .where(
          and(
            eq(tickets.requesterPrincipalId, params.principalId),
            isNull(tickets.deletedAt),
            isNull(tickets.mergedIntoTicketId),
          ),
        )
        .orderBy(desc(tickets.updatedAt))
        .limit(perSource);
      for (const r of rows) {
        items.push({
          kind: "ticket",
          id: r.id,
          title: `#${r.number} ${r.title}`,
          preview: null,
          channel: "ticket",
          status: r.status ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        });
      }
    }

    if (want("post")) {
      const rows = await db
        .select({
          id: posts.id,
          title: posts.title,
          content: posts.content,
          createdAt: posts.createdAt,
          updatedAt: posts.updatedAt,
        })
        .from(posts)
        .where(
          and(
            eq(posts.principalId, params.principalId),
            isNull(posts.deletedAt),
          ),
        )
        .orderBy(desc(posts.updatedAt))
        .limit(perSource);
      for (const r of rows) {
        items.push({
          kind: "post",
          id: r.id,
          title: r.title,
          preview: r.content?.slice(0, 200) ?? null,
          channel: "feedback",
          status: null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        });
      }
    }

    if (want("comment")) {
      const rows = await db
        .select({
          id: postComments.id,
          content: postComments.content,
          postTitle: posts.title,
          createdAt: postComments.createdAt,
          updatedAt: postComments.updatedAt,
        })
        .from(postComments)
        .innerJoin(posts, eq(posts.id, postComments.postId))
        .where(
          and(
            eq(postComments.principalId, params.principalId),
            isNull(postComments.deletedAt),
            isNull(posts.deletedAt),
          ),
        )
        .orderBy(
          desc(
            sql`coalesce(${postComments.updatedAt}, ${postComments.createdAt})`,
          ),
        )
        .limit(perSource);
      for (const r of rows) {
        items.push({
          kind: "comment",
          id: r.id,
          title: r.postTitle ? `Comment on ${r.postTitle}` : "Feedback comment",
          preview: r.content.slice(0, 200),
          channel: "feedback",
          status: null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt ?? r.createdAt,
        });
      }
    }

    if (want("signal")) {
      const rows = await db
        .select({
          id: feedbackSignals.id,
          excerpt: feedbackSignals.excerpt,
          suggestedTitle: feedbackSignals.suggestedTitle,
          status: feedbackSignals.status,
          createdAt: feedbackSignals.createdAt,
        })
        .from(feedbackSignals)
        .where(eq(feedbackSignals.principalId, params.principalId))
        .orderBy(desc(feedbackSignals.createdAt))
        .limit(perSource);
      for (const r of rows) {
        items.push({
          kind: "signal",
          id: r.id,
          title: r.suggestedTitle || "Feedback signal",
          preview: r.excerpt.slice(0, 200),
          channel: "signal",
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.createdAt,
        });
      }
    }

    if (want("survey")) {
      const rows = await db
        .select({
          id: surveyResponses.id,
          score: surveyResponses.score,
          comment: surveyResponses.comment,
          surveyQuestion: surveys.question,
          createdAt: surveyResponses.createdAt,
        })
        .from(surveyResponses)
        .leftJoin(surveys, eq(surveys.id, surveyResponses.surveyId))
        .where(eq(surveyResponses.principalId, params.principalId))
        .orderBy(desc(surveyResponses.createdAt))
        .limit(perSource);
      for (const r of rows) {
        items.push({
          kind: "survey",
          id: r.id,
          title: r.surveyQuestion ?? "Survey response",
          preview: r.comment
            ? `${r.score !== null ? `Score ${r.score}: ` : ""}${r.comment.slice(0, 180)}`
            : r.score !== null
              ? `Score ${r.score}`
              : null,
          channel: "survey",
          status: null,
          createdAt: r.createdAt,
          updatedAt: r.createdAt,
        });
      }
    }

    items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return { items: items.slice(0, query.limit) };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...getTimeline,
);
