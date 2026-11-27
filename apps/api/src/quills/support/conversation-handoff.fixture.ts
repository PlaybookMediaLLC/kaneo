import { fixture } from "../framework/contract";
import { seed, type Ids } from "./conversation-seed.fixture";

export const checkQuillsConversationDraft = fixture({
  seed,
  valid: (ids: Ids) => ({
    params: { conversationId: ids.a.conversationId },
    body: { draft: "Could you share your order ID and browser?" },
  }),
  foreign: (ids: Ids) => ({ conversationId: ids.b.conversationId }),
});
