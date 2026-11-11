import { fixture } from "../framework/contract";
import { seed, seeded, type Ids } from "./conversation-seed.fixture";

// The batch IDs are an array (not an `...Id` field); conversations.test.ts covers foreign IDs and rollback.

export const bulkQuillsUpdateConversations = fixture({
  seed,
  valid: (ids: Ids) => ({
    body: {
      conversationIds: [ids.a.conversationId],
      action: { type: "priority", priority: "urgent" },
    },
  }),
});
export const bulkQuillsDeleteConversations = fixture({
  seed: seeded("spam"),
  valid: (ids: Ids) => ({ body: { conversationIds: [ids.a.spamId] } }),
});
