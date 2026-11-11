import { fixture } from "../framework/contract";
import {
  deletePost,
  seed,
  softDeleteBoard,
  softDeletePost,
  type Ids,
} from "./seed.fixture";

/** A request on A's post, with extra input and the workspace B values for its IDs. */
const onPost = (
  extra: (ids: Ids) => object = () => ({}),
  more: (ids: Ids) => Record<string, string> = () => ({}),
) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({ params: { postId: ids.a.postId }, ...extra(ids) }),
    foreign: (ids: Ids) => ({ postId: ids.b.postId, ...more(ids) }),
    softDelete: softDeletePost,
  });
const all = fixture({ seed, valid: () => ({}) });

export const listQuillsPosts = all;
export const getQuillsPostFilterCounts = all;
export const listQuillsPostOwnerCandidates = all;
export const getQuillsPost = onPost();
export const listQuillsPostActivity = onPost();
export const deleteQuillsPost = onPost();
// Its target is a deleted post.
export const restoreQuillsPost = {
  ...onPost(),
  seed: deletePost,
  softDelete: undefined,
};
export const createQuillsPost = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      boardId: a.boardId,
      statusId: a.statusId,
      title: "Contract post",
      content: "Details",
      tagIds: [a.tagId],
    },
  }),
  foreign: ({ b }: Ids) => ({ boardId: b.boardId, statusId: b.statusId }),
  softDelete: softDeleteBoard,
});
export const updateQuillsPost = onPost(() => ({
  body: { title: "Edited", content: "Edited", isCommentsLocked: true },
}));
export const setQuillsPostStatus = onPost(
  ({ a }) => ({ body: { statusId: a.otherStatusId } }),
  ({ b }) => ({ statusId: b.otherStatusId }),
);
export const setQuillsPostBoard = onPost(
  ({ a }) => ({ body: { boardId: a.otherBoardId } }),
  ({ b }) => ({ boardId: b.otherBoardId }),
);
export const setQuillsPostOwner = onPost(
  ({ a }) => ({ body: { ownerPrincipalId: a.ownerId } }),
  ({ b }) => ({ ownerPrincipalId: b.ownerId }),
);
export const setQuillsPostTags = onPost(({ a }) => ({
  body: { tagIds: [a.tagId] },
}));
