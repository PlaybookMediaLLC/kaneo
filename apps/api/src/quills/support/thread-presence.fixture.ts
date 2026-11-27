import { onConversation } from "./conversation-seed.fixture";
import { onTicket } from "./seed.fixture";

export const setQuillsConversationViewer = onConversation(() => ({
  body: { state: "replying" },
}));
export const listQuillsConversationViewers = onConversation();
export const setQuillsTicketViewer = onTicket(() => ({
  body: { state: "replying" },
}));
export const listQuillsTicketViewers = onTicket();
