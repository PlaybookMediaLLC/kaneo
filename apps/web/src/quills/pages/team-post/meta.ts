import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-post",
  feature: "team-post",
  route: "/feedback/$workspaceId/posts/$postId",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  // The request order: the page queries (the posts wait for the statuses), then the voters of
  // the chip row and the properties panel from top to bottom. The tags load when the tag menu
  // opens, listQuillsUsers waits for a typed proxy-vote search, and the merge palette's
  // listQuillsPosts search waits for a typed query.
  operations: [
    "getQuillsPost",
    "listQuillsPostComments",
    "listQuillsStatuses",
    "listQuillsBoards",
    "listQuillsPosts",
    "listQuillsPostVoters",
    "getQuillsPostDemand",
    "listQuillsLinks",
    "getQuillsLinkedConversationsForPost",
    "listQuillsMergedPosts",
    "listQuillsTags",
    "listQuillsUsers",
    "createQuillsComment",
    "setQuillsPostStatus",
    "setQuillsPostBoard",
    "setQuillsPostTags",
    "addQuillsPostProxyVote",
    "removeQuillsPostVote",
    "setQuillsPostScore",
    "mergeQuillsPost",
    "unmergeQuillsPost",
    "deleteQuillsPost",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
