import { fixture } from "../framework/contract";
import { onConversation, seeded, type Ids } from "./conversation-seed.fixture";

export const listQuillsConversationParticipants = onConversation(
  undefined,
  undefined,
  ["participants"],
);
export const addQuillsConversationParticipant = onConversation(
  (ids) => ({ body: { principalId: ids.a.otherCustomerId } }),
  (ids) => ({ principalId: ids.b.otherCustomerId }),
  ["participants"],
);
export const removeQuillsConversationParticipant = fixture({
  seed: seeded("participants"),
  valid: (ids: Ids) => ({
    params: {
      conversationId: ids.a.conversationId,
      principalId: ids.a.participantId,
    },
  }),
  foreign: (ids: Ids) => ({
    conversationId: ids.b.conversationId,
    principalId: ids.b.participantId,
  }),
});
