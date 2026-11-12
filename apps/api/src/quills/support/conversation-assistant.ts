import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { isTypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  ASSISTANT_INVOLVEMENT_STATUSES,
  assistantInvolvements,
} from "../../database/quills/schema/assistant";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import { posts } from "../../database/quills/schema/posts";
import { defineQuillsRoute } from "../framework/define-route";
import { loadCustomer, realEmail } from "../directory/customer";
import { loadProjects, visiblePost } from "../feedback/visibility";
import { notSpam } from "./conversation-list";
import {
  conflict,
  conversationItem,
  conversationParams,
  errors,
  findConversation,
  loadConversation,
  messageText,
  preview,
  realConversation,
} from "./conversation-model";
import { insertReply } from "./conversation-ops";
import { loadMessage, messageSchema } from "./message-model";

// The assistant side of the inbox (RFC 0001, lane G2) and the outbound start. See CONVERSATIONS.md.

/** The assistant inbox buckets, by involvement status (the source's AI_INBOX_BUCKETS). */
const BUCKETS = {
  resolved: ["resolved_confirmed", "resolved_assumed"],
  escalated: ["handed_off"],
  pending: ["active"],
} as const;
/** A stored source list is not bounded by a schema; the response is. */
const MAX_SOURCES = 50;
/** One stored citation. Imported rows are not validated: a malformed entry is left out. */
const storedSource = z.object({
  type: z.string(),
  id: z.string(),
  title: z.string().nullish(),
  url: z.string().nullish(),
});

const start = defineQuillsRoute({
  method: "post",
  path: "/conversations",
  operationId: "startQuillsAgentConversation",
  summary: "Start a conversation with a customer",
  description:
    "Opens an email conversation with an identified customer, assigned to the caller, with the caller's plain-text message. The delivery worker mails the message to the customer after commit (`message.created`), and the customer's mail reply threads back; the request sends nothing. A lead, a blocked customer or a customer with no real mail address is refused.",
  action: "update",
  body: z.object({
    targetPrincipalId: flexibleToTypeIdSchema("principal"),
    content: messageText,
  }),
  response: z.object({
    conversation: conversationItem,
    message: messageSchema,
  }),
  responseDescription: "The new conversation and its first message",
  errors: {
    404: "Person not found",
    409: "The customer cannot receive the message",
  },
  // `message.created` also drives the reply mail, as for every teammate reply on an email thread.
  event: (_input, result) => [
    {
      type: "conversation.agent_started" as const,
      entityType: "conversation" as const,
      entityId: result.conversation.id,
      payload: { messageId: result.message.id } as Record<string, string>,
    },
    {
      type: "message.created" as const,
      entityType: "conversation_message" as const,
      entityId: result.message.id,
      payload: { conversationId: result.conversation.id },
    },
  ],
  handler: async ({ db, actor, body }) => {
    const target = await loadCustomer(db, body.targetPrincipalId);
    if (target.type !== "user")
      throw conflict(
        "Conversations can only be started with identified customers",
      );
    if (
      target.blockedAt ||
      !(realEmail(target.contactEmail) ?? realEmail(target.email))
    )
      throw conflict("This customer has no address to mail the message to");
    const [created] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: body.targetPrincipalId,
        // Kaneo's inbound mail threads only into email conversations; the source promotes a
        // messenger thread to email when the customer replies by mail.
        channel: "email",
        // The composer owns the thread from the start.
        assignedAgentPrincipalId: actor.principalId,
        status: "open",
        subject: preview(body.content),
      })
      .returning();
    const messageId = await insertReply(db, actor, created!, body.content);
    return {
      conversation: await loadConversation(db, created!.id),
      message: await loadMessage(db, actor, messageId),
    };
  },
});

const counts = defineQuillsRoute({
  method: "get",
  path: "/inbox/assistant-counts",
  operationId: "fetchQuillsAssistantInboxCounts",
  summary: "Count the conversations in each assistant inbox bucket",
  description:
    "Conversations that the customer agent resolved, escalated to a teammate, or still handles. Each counts once per bucket. The inbox list's rule applies first: test customers' and spam conversations are not counted.",
  action: "read",
  response: z.object({
    resolved: z.number(),
    escalated: z.number(),
    pending: z.number(),
  }),
  responseDescription: "Counts",
  handler: async ({ db }) => {
    const bucket = (
      statuses: readonly (typeof ASSISTANT_INVOLVEMENT_STATUSES)[number][],
    ) =>
      sql<number>`count(distinct ${assistantInvolvements.conversationId}) filter (where ${inArray(assistantInvolvements.status, [...statuses])})::int`;
    const [row] = await db
      .select({
        resolved: bucket(BUCKETS.resolved),
        escalated: bucket(BUCKETS.escalated),
        pending: bucket(BUCKETS.pending),
      })
      .from(assistantInvolvements)
      .innerJoin(
        conversations,
        eq(conversations.id, assistantInvolvements.conversationId),
      )
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .where(and(realConversation, notSpam));
    // An aggregate with no GROUP BY returns one row.
    return row!;
  },
});

const activity = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/assistant-activity",
  operationId: "getQuillsConversationAssistantActivity",
  summary: "Get the customer agent's activity on a conversation",
  description:
    "The agent's latest involvement: outcome, handoff reason, cited sources, rating and the time of its last answer. `activity` is null when the agent never took part. A cited post on a board that the caller cannot see is left out.",
  action: "read",
  params: conversationParams,
  load: loadProjects,
  response: z.object({
    activity: z
      .object({
        outcome: z.enum(ASSISTANT_INVOLVEMENT_STATUSES),
        handoffReason: z.string().nullable(),
        sources: z.array(
          z.object({
            type: z.string(),
            id: z.string(),
            title: z.string(),
            url: z.string(),
          }),
        ),
        rating: z.number().nullable(),
        answeredAt: nullableResponseTimestamp,
      })
      .nullable(),
  }),
  responseDescription: "The latest involvement, or null",
  errors,
  handler: async ({ db, params, loaded: projects }) => {
    await findConversation(db, params.conversationId);
    const [latest] = await db
      .select({
        outcome: assistantInvolvements.status,
        handoffReason: assistantInvolvements.handoffReason,
        sources: assistantInvolvements.sources,
        rating: assistantInvolvements.rating,
        answeredAt: assistantInvolvements.lastAssistantAnswerAt,
      })
      .from(assistantInvolvements)
      .where(eq(assistantInvolvements.conversationId, params.conversationId))
      .orderBy(
        desc(assistantInvolvements.createdAt),
        desc(assistantInvolvements.id),
      )
      .limit(1);
    if (!latest) return { activity: null };
    const stored = (
      Array.isArray(latest.sources) ? (latest.sources as unknown[]) : []
    ).flatMap((raw) => {
      const parsed = storedSource.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });
    // A malformed post ID is left out, never cast.
    const postIds = stored.flatMap((source) =>
      source.type === "post" && isTypeId(source.id, "post") ? [source.id] : [],
    );
    const visible = new Set<string>(
      postIds.length
        ? (
            await db
              .select({ id: posts.id })
              .from(posts)
              .where(and(inArray(posts.id, postIds), visiblePost(projects)))
          ).map((row) => row.id)
        : [],
    );
    return {
      activity: {
        ...latest,
        // Visibility first, then the bound.
        sources: stored
          .filter((source) => source.type !== "post" || visible.has(source.id))
          .slice(0, MAX_SOURCES)
          .map((source) => ({
            ...source,
            title: source.title ?? "",
            url: source.url ?? "",
          })),
      },
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...start)
  .openapi(...counts)
  .openapi(...activity);
