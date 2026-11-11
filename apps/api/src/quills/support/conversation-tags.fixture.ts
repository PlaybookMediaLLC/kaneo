import { fixture } from "../framework/contract";
import {
  all,
  onConversation,
  seed,
  seeded,
  type Ids,
} from "./conversation-seed.fixture";

const tagged = seeded("tags");

const onTag = (pick: (side: Ids["a"]) => string) =>
  fixture({
    seed: tagged,
    valid: (ids: Ids) => ({ params: { tagId: pick(ids.a) } }),
    foreign: (ids: Ids) => ({ tagId: pick(ids.b) }),
  });
const live = onTag((side) => side.tagId);
const archived = onTag((side) => side.archivedTagId);

export const listQuillsConversationTags = all;
export const listQuillsConversationTagUsage = all;
export const createQuillsConversationTag = fixture({
  seed,
  valid: (ids: Ids) => ({ body: { name: ids.a.newTagName, color: "#112233" } }),
});
export const updateQuillsConversationTag = fixture({
  ...live,
  valid: (ids: Ids) => ({
    ...live.valid(ids),
    body: { name: ids.a.newTagName },
  }),
});
export const archiveQuillsConversationTag = live;
export const restoreQuillsConversationTag = archived;
export const deleteQuillsConversationTag = archived;
export const addQuillsConversationTag = onConversation(
  (ids) => ({ body: { tagId: ids.a.freeTagId } }),
  (ids) => ({ tagId: ids.b.freeTagId }),
  ["tags"],
);
export const removeQuillsConversationTag = fixture({
  seed: tagged,
  valid: (ids: Ids) => ({
    params: { conversationId: ids.a.conversationId, tagId: ids.a.tagId },
  }),
  foreign: (ids: Ids) => ({
    conversationId: ids.b.conversationId,
    tagId: ids.b.tagId,
  }),
});
