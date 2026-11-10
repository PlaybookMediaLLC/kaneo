import { fixture } from "../../framework/contract";
import { shared } from "../../portal/feedback/routes.fixture";
import { world } from "../../portal/feedback/seed.fixture";
import { enableWidget } from "../seed.fixture";

const all = shared("widget");

export const listQuillsWidgetBoards = all.listQuillsWidgetBoards!;
export const listQuillsWidgetPosts = all.listQuillsWidgetPosts!;
export const findQuillsWidgetSimilarPosts = all.findQuillsWidgetSimilarPosts!;
export const getQuillsWidgetPost = all.getQuillsWidgetPost!;
export const createQuillsWidgetPost = all.createQuillsWidgetPost!;
export const setQuillsWidgetVote = all.setQuillsWidgetVote!;
export const setQuillsWidgetFollow = all.setQuillsWidgetFollow!;
export const listQuillsWidgetVotedPosts = all.listQuillsWidgetVotedPosts!;
export const getQuillsWidgetUserStats = all.getQuillsWidgetUserStats!;
export const listQuillsWidgetPostComments = all.listQuillsWidgetPostComments!;
export const createQuillsWidgetComment = all.createQuillsWidgetComment!;
export const setQuillsWidgetCommentReaction =
  all.setQuillsWidgetCommentReaction!;
export const listQuillsWidgetChangelog = all.listQuillsWidgetChangelog!;
export const getQuillsWidgetChangelogEntry = all.getQuillsWidgetChangelogEntry!;

export const createQuillsWidgetAnonymousSession = fixture({
  seed: async (env) => {
    await enableWidget(env, env.a);
    return { b: await world(env, env.b) };
  },
  valid: () => ({}),
  hidden: (s) => [...s.b.hidden, s.b.postTitle],
});
