import { fixture } from "../framework/contract";
import { on } from "./seed.fixture";

const onConversation = on(
  ["conversation"],
  (a) => ({ params: { conversationId: a.conversationId } }),
  (b) => ({ conversationId: b.conversationId }),
);
const onTicket = on(
  ["ticket"],
  (a) => ({ params: { ticketId: a.ticketId } }),
  (b) => ({ ticketId: b.ticketId }),
);

export const requestQuillsConversationSummary = onConversation;
export const requestQuillsTicketSummary = onTicket;
export const getQuillsTicketSummary = onTicket;
export const suggestQuillsTicketFieldValues = onTicket;
export const translateQuillsConversationMessages = on(
  ["conversation"],
  (a) => ({
    params: { conversationId: a.conversationId, messageId: a.visitorMessageId },
    body: { language: "German" },
  }),
  (b) => ({ conversationId: b.conversationId, messageId: b.visitorMessageId }),
);
export const draftQuillsAttributeDescriptions = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { label: "Plan", fieldType: "select", options: ["free", "pro"] },
  }),
});
export const previewQuillsAttributeDetection = on(
  ["attribute", "conversation"],
  (a) => ({
    params: { attributeId: a.attributeId },
    body: { conversationId: a.conversationId },
  }),
  (b) => ({ attributeId: b.attributeId, conversationId: b.conversationId }),
);
