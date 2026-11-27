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
const scheduledMessage = fixture({
  seed: async (env, caller) => {
    const ids = await seeded("own")(env, caller);
    const future = new Date(Date.now() + 60_000);
    const makeScheduled = async (ws: string, convId: string, userId?: string) =>
      env.scoped(
        ws,
        async (db, actor) => {
          const { conversationMessages } =
            await import("../../database/quills/schema/conversation");
          const [row] = await db
            .insert(conversationMessages)
            .values({
              conversationId: convId as never,
              principalId: actor.principalId,
              senderType: "agent",
              content: "Scheduled draft",
              sendStatus: "scheduled",
              scheduledSendAt: future,
            })
            .returning({ id: conversationMessages.id });
          return row!.id;
        },
        userId,
      );
    const [aScheduledId, bScheduledId] = await Promise.all([
      makeScheduled(env.a, ids.a.conversationId, caller),
      makeScheduled(env.b, ids.b.conversationId),
    ]);
    return { ...ids, aScheduledId, bScheduledId };
  },
  valid: (ids) => ({ params: { messageId: ids.aScheduledId } }),
  foreign: (ids) => ({ messageId: ids.bScheduledId }),
});
export const recallQuillsScheduledMessage = scheduledMessage;
export const sendQuillsScheduledMessageNow = scheduledMessage;
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
