import { fixture } from "../framework/contract";
import { onConversation, seeded, type Ids } from "./conversation-seed.fixture";

export const createQuillsPostFromConversation = onConversation(
  (ids) => ({
    body: { boardId: ids.a.boardId, title: "Tracked from support" },
  }),
  (ids) => ({ boardId: ids.b.boardId }),
  ["posts"],
);
export const shareQuillsPost = onConversation(
  (ids) => ({ body: { postId: ids.a.postId } }),
  (ids) => ({ postId: ids.b.postId }),
  ["posts"],
);
export const getQuillsLinkedPostsForConversation = onConversation();
export const getQuillsLinkedConversationsForPost = fixture({
  seed: seeded("posts"),
  valid: (ids: Ids) => ({ params: { postId: ids.a.postId } }),
  foreign: (ids: Ids) => ({ postId: ids.b.postId }),
});
