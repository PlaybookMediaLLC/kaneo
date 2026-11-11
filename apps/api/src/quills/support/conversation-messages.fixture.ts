import { fixture } from "../framework/contract";
import {
  all,
  onConversation,
  seed,
  seeded,
  withReactions,
  type Ids,
} from "./conversation-seed.fixture";

const onMessage = (pick: (side: Ids["a"]) => string, own = false) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({
      params: { messageId: own ? ids.ownMessageId : pick(ids.a) },
    }),
    foreign: (ids: Ids) => ({ messageId: pick(ids.b) }),
  });
const visitorMessage = onMessage((side) => side.visitorMessageId);
const withEmoji = (ids: Ids) => ({
  ...visitorMessage.valid(ids),
  query: { emoji: "👍" },
});

export const listQuillsConversationMessages = onConversation();
export const replyQuillsConversation = onConversation(() => ({
  body: { content: "We fixed it" },
}));
export const addQuillsConversationNote = onConversation((ids) => ({
  body: { content: "Check billing", mentionPrincipalIds: [ids.a.teammateId] },
}));
export const updateQuillsConversationMessage = fixture({
  ...onMessage((side) => side.agentMessageId, true),
  seed: seeded("own"),
  valid: (ids: Ids) => ({
    params: { messageId: ids.ownMessageId },
    body: { content: "Edited" },
  }),
});
export const deleteQuillsConversationMessage = visitorMessage;
export const setQuillsMessageReaction = { ...visitorMessage, valid: withEmoji };
export const removeQuillsMessageReaction = {
  ...visitorMessage,
  seed: withReactions,
  valid: withEmoji,
};
export const setQuillsMessageFlag = visitorMessage;
export const removeQuillsMessageFlag = visitorMessage;
export const listQuillsFlaggedMessages = all;
export const markQuillsConversationRead = onConversation();
export const markQuillsConversationUnreadFromMessage = onConversation(
  (ids) => ({ body: { messageId: ids.a.visitorMessageId } }),
  (ids) => ({ messageId: ids.b.visitorMessageId }),
);
