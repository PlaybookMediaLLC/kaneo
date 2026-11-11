import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { conversationMessages } from "../../database/quills/schema/conversation";
import { conversationAttributeDefinitions } from "../../database/quills/schema/conversation-attributes";
import { ticketSummaries } from "../../database/quills/schema/ticket-summary";
import { tickets } from "../../database/quills/schema/tickets";
import { ticketTypes } from "../../database/quills/schema/ticket-types";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { requireItem } from "./copilot";
import { chatJson, requireAi, toHttp, untrusted } from "./provider";
import { createRun, logUsage, runSchema, runView } from "./runs";

// AI features of conversations and tickets. A summary is stored by a worker after commit. A
// translation, a detection preview and field suggestions are runs that a worker answers. An
// attribute description draft uses only the request text, so it calls the provider in `load`.

const conversationParams = z.object({
  conversationId: flexibleToTypeIdSchema("conversation"),
});
const ticketParams = z.object({ ticketId: flexibleToTypeIdSchema("ticket") });
const requested = z.object({ requested: z.literal(true) });
const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });
const aiLoad = async () => {
  requireAi();
};
const runEvent = (_input: unknown, run: { id: string; kind: string }) => ({
  type: "assistant_run.requested" as const,
  entityType: "assistant_run" as const,
  entityId: run.id,
  payload: { kind: run.kind },
});

const conversationSummary = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/summary",
  operationId: "requestQuillsConversationSummary",
  summary: "Summarize a conversation",
  description:
    "A worker writes the summary after commit (getQuillsConversation returns it) and records conversation.summarized. 409 when AI is not configured.",
  action: "update",
  params: conversationParams,
  load: aiLoad,
  response: requested,
  responseDescription: "The request was recorded",
  errors: { 404: "Conversation not found", 409: "AI is not configured" },
  event: ({ params }) => ({
    type: "conversation.summary_requested",
    entityType: "conversation",
    entityId: params.conversationId,
  }),
  handler: async ({ db, params }) => {
    await requireItem(db, params);
    return { requested: true as const };
  },
});

const ticketSummary = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/summary",
  operationId: "requestQuillsTicketSummary",
  summary: "Summarize a ticket",
  description:
    "A worker writes the summary after commit and records ticket.summarized. 409 when AI is not configured.",
  action: "update",
  params: ticketParams,
  load: aiLoad,
  response: requested,
  responseDescription: "The request was recorded",
  errors: { 404: "Ticket not found", 409: "AI is not configured" },
  event: ({ params }) => ({
    type: "ticket.summary_requested",
    entityType: "ticket",
    entityId: params.ticketId,
  }),
  handler: async ({ db, params }) => {
    await requireItem(db, params);
    return { requested: true as const };
  },
});

const getTicketSummary = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/summary",
  operationId: "getQuillsTicketSummary",
  summary: "Get a ticket's AI summary",
  action: "read",
  params: ticketParams,
  response: z.object({
    ticketId: z.string(),
    summary: z.string().nullable(),
    updatedAt: nullableResponseTimestamp,
  }),
  responseDescription: "The stored summary, or null",
  errors: { 404: "Ticket not found" },
  handler: async ({ db, params }) => {
    await requireItem(db, params);
    const [row] = await db
      .select({
        summary: ticketSummaries.summary,
        updatedAt: ticketSummaries.updatedAt,
      })
      .from(ticketSummaries)
      .where(eq(ticketSummaries.ticketId, params.ticketId));
    return {
      ticketId: params.ticketId,
      summary: row?.summary ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  },
});

const translate = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/messages/{messageId}/translate",
  operationId: "translateQuillsConversationMessages",
  summary: "Translate a conversation message",
  description:
    "Returns a pending run; a worker stores the translation as its `text`. 409 when AI is not configured.",
  action: "read",
  params: conversationParams.extend({
    messageId: flexibleToTypeIdSchema("conversation_msg"),
  }),
  body: z.object({ language: z.string().trim().min(2).max(60) }),
  load: aiLoad,
  response: runSchema,
  responseDescription: "The pending run",
  errors: {
    404: "Conversation or message not found",
    409: "AI is not configured",
  },
  event: runEvent,
  handler: async ({ db, actor, params, body }) => {
    const [message] = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, params.messageId),
          eq(conversationMessages.conversationId, params.conversationId),
          isNull(conversationMessages.deletedAt),
        ),
      );
    if (!message) throw notFound("Message");
    const { id, run } = await createRun(
      db,
      actor.principalId,
      "translate_message",
      { messageId: message.id, language: body.language },
    );
    return runView(id, run);
  },
});

const textAnswer = z.object({ text: z.string().min(1).max(500) });

const draftDescription = defineQuillsRoute({
  method: "post",
  path: "/conversation-attributes/description-draft",
  operationId: "draftQuillsAttributeDescriptions",
  summary: "Draft a conversation attribute description with AI",
  description:
    "The model writes a short description that tells AI detection what the attribute means. 409 when AI is not configured, 502 when the provider fails.",
  action: "manage_settings",
  body: z.object({
    label: z.string().trim().min(1).max(80),
    fieldType: z.string().trim().min(1).max(40),
    options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  }),
  load: async ({ body }) => {
    requireAi();
    return chatJson(textAnswer, [
      {
        role: "system",
        content:
          'You write one or two sentences that describe a support conversation attribute, so that an AI can decide its value from a conversation. Answer with one JSON object: {"text": string}.',
      },
      {
        role: "user",
        content: untrusted(
          "attribute",
          `Label: ${body.label}\nType: ${body.fieldType}\nOptions: ${body.options.join(", ") || "none"}`,
        ),
      },
    ]).catch((error) => {
      throw toHttp(error);
    });
  },
  response: z.object({ text: z.string() }),
  responseDescription: "The drafted description",
  errors: { 409: "AI is not configured" },
  event: {
    none: "A draft changes no domain data; the usage log row is its record",
  },
  handler: async ({ db, loaded }) => {
    await logUsage(db, [
      {
        step: "attribute_description",
        callType: "chat_completion",
        usage: loaded.usage,
      },
    ]);
    return { text: loaded.value.text };
  },
});

const detectionPreview = defineQuillsRoute({
  method: "post",
  path: "/conversation-attributes/{attributeId}/detection-preview",
  operationId: "previewQuillsAttributeDetection",
  summary: "Preview AI detection of an attribute on a conversation",
  description:
    "Returns a pending run; a worker stores the detected value in `values`. Nothing is written to the conversation. 409 when AI is not configured.",
  action: "manage_settings",
  params: z.object({ attributeId: flexibleToTypeIdSchema("conv_attr") }),
  body: z.object({ conversationId: flexibleToTypeIdSchema("conversation") }),
  load: aiLoad,
  response: runSchema,
  responseDescription: "The pending run",
  errors: {
    404: "Attribute or conversation not found",
    409: "AI is not configured",
  },
  event: runEvent,
  handler: async ({ db, actor, params, body }) => {
    const [attribute] = await db
      .select({ id: conversationAttributeDefinitions.id })
      .from(conversationAttributeDefinitions)
      .where(
        and(
          eq(conversationAttributeDefinitions.id, params.attributeId),
          isNull(conversationAttributeDefinitions.archivedAt),
        ),
      );
    if (!attribute) throw notFound("Attribute");
    await requireItem(db, body);
    const { id, run } = await createRun(
      db,
      actor.principalId,
      "attribute_preview",
      { attributeId: attribute.id, conversationId: body.conversationId },
    );
    return runView(id, run);
  },
});

async function typedTicket(db: Database, id: string) {
  const [ticket] = await db
    .select({ id: tickets.id, fields: ticketTypes.fields })
    .from(tickets)
    .leftJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .where(and(eq(tickets.id, id as never), isNull(tickets.deletedAt)));
  if (!ticket) throw notFound("Ticket");
  if (!ticket.fields?.length)
    throw new HTTPException(409, {
      message: "This ticket's type has no fields to suggest",
    });
  return ticket;
}

const fieldSuggestions = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/field-suggestions",
  operationId: "suggestQuillsTicketFieldValues",
  summary: "Suggest values for a ticket's fields with AI",
  description:
    "Returns a pending run; a worker stores one suggestion per field in `values`. Nothing is written to the ticket. 409 when AI is not configured or the ticket's type has no fields.",
  action: "read",
  params: ticketParams,
  load: aiLoad,
  response: runSchema,
  responseDescription: "The pending run",
  errors: {
    404: "Ticket not found",
    409: "AI is not configured, or the ticket type has no fields",
  },
  event: runEvent,
  handler: async ({ db, actor, params }) => {
    const ticket = await typedTicket(db, params.ticketId);
    const { id, run } = await createRun(
      db,
      actor.principalId,
      "ticket_fields",
      {
        ticketId: ticket.id,
      },
    );
    return runView(id, run);
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...conversationSummary)
  .openapi(...ticketSummary)
  .openapi(...getTicketSummary)
  .openapi(...translate)
  .openapi(...draftDescription)
  .openapi(...detectionPreview)
  .openapi(...fieldSuggestions);
