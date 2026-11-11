import { apiRouter, z, type BaseVariables } from "../../../openapi";
import { defineQuillsRoute } from "../../framework/define-route";
import { conversationParams, findConversation } from "../conversation-model";
import { isTyping, signalTyping } from "./model";

// The teammate side of the typing markers that the customer routes write and read.

const errors = { 404: "Conversation not found" };

const read = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/typing",
  operationId: "getQuillsConversationTyping",
  summary: "Get whether the customer is typing",
  description:
    "True for a few seconds after the customer's widget or portal signals typing.",
  action: "read",
  params: conversationParams,
  response: z.object({ visitorTyping: z.boolean() }),
  responseDescription: "The customer's typing state",
  errors,
  handler: async ({ db, params }) => {
    const conversation = await findConversation(db, params.conversationId);
    return { visitorTyping: await isTyping(db, conversation.id, "visitor") };
  },
});

const write = defineQuillsRoute({
  method: "put",
  path: "/conversations/{conversationId}/typing",
  operationId: "sendQuillsConversationTyping",
  summary: "Signal that a teammate is typing to the customer",
  description:
    "A bounded write: one marker per conversation side that lapses after 8 seconds. The customer reads it as teamTyping.",
  action: "update",
  params: conversationParams,
  response: z.object({ ok: z.literal(true) }),
  responseDescription: "The signal is stored",
  errors,
  event: { none: "Ephemeral: the marker lapses after a few seconds" },
  handler: async ({ db, params }) => {
    const conversation = await findConversation(db, params.conversationId);
    await signalTyping(db, conversation.id, "agent");
    return { ok: true as const };
  },
});

/** Teammate routes for typing markers. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...read)
  .openapi(...write);
