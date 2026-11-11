import { portalOnly, publicFeeds, shared } from "./routes.fixture";

const all = { ...shared("portal"), ...portalOnly, ...publicFeeds };

export const listQuillsPortalBoards = all.listQuillsPortalBoards!;
export const listQuillsPortalPosts = all.listQuillsPortalPosts!;
export const findQuillsPortalSimilarPosts = all.findQuillsPortalSimilarPosts!;
export const getQuillsPortalPost = all.getQuillsPortalPost!;
export const createQuillsPortalPost = all.createQuillsPortalPost!;
export const setQuillsPortalVote = all.setQuillsPortalVote!;
export const setQuillsPortalFollow = all.setQuillsPortalFollow!;
export const listQuillsPortalVotedPosts = all.listQuillsPortalVotedPosts!;
export const getQuillsPortalUserStats = all.getQuillsPortalUserStats!;
export const listQuillsPortalPostComments = all.listQuillsPortalPostComments!;
export const createQuillsPortalComment = all.createQuillsPortalComment!;
export const setQuillsPortalCommentReaction =
  all.setQuillsPortalCommentReaction!;
export const listQuillsPortalChangelog = all.listQuillsPortalChangelog!;
export const getQuillsPortalChangelogEntry = all.getQuillsPortalChangelogEntry!;
export const listQuillsPortalStatuses = all.listQuillsPortalStatuses!;
export const listQuillsPortalTags = all.listQuillsPortalTags!;
export const listQuillsPortalRoadmaps = all.listQuillsPortalRoadmaps!;
export const listQuillsPortalRoadmapPosts = all.listQuillsPortalRoadmapPosts!;
export const editQuillsPortalOwnPost = all.editQuillsPortalOwnPost!;
export const deleteQuillsPortalOwnPost = all.deleteQuillsPortalOwnPost!;
export const editQuillsPortalOwnComment = all.editQuillsPortalOwnComment!;
export const deleteQuillsPortalOwnComment = all.deleteQuillsPortalOwnComment!;
export const getQuillsPublicChangelogFeed = all.getQuillsPublicChangelogFeed!;
export const getQuillsPublicSitemap = all.getQuillsPublicSitemap!;
