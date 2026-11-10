import {
  fixture,
  type ContractInput,
  type Fixture,
} from "../../framework/contract";
import { probe, scene, world, type Scene } from "./seed.fixture";
import { title, type Customer as Who } from "./viewer";

// Contract fixtures for the customer feedback routes, for both audiences. Each request names
// workspace A's rows; `hidden` is every row a customer must not see plus workspace B's rows.

type Spec = {
  valid: (s: Scene) => ContractInput;
  foreign?: (s: Scene) => Record<string, string>;
};

const hiddenOf = (s: Scene) => [
  ...s.a.hidden,
  ...s.b.hidden,
  s.b.postTitle,
  s.b.postId,
];

const make = (who: Who, spec: Spec) =>
  fixture<Scene>({
    seed: (env) => scene(env, who),
    valid: (s) => ({ ...spec.valid(s), ...(s.token && { bearer: s.token }) }),
    foreign: spec.foreign,
    hidden: hiddenOf,
    own: (s) => s.a.own,
    probe,
  });

const post = (s: Scene) => ({ postId: s.a.postId });
const foreignPost = (s: Scene) => ({ postId: s.b.postId });

/** The fixtures of every route that both audiences declare, keyed by operationId. */
export function shared(who: Who): Record<string, Fixture> {
  const t = title(who);
  return {
    [`listQuills${t}Boards`]: make(who, { valid: () => ({}) }),
    [`listQuills${t}Posts`]: make(who, {
      valid: (s) => ({ query: { boardId: s.a.boardId, sort: "votes" } }),
      foreign: (s) => ({ boardId: s.b.boardId }),
    }),
    [`findQuills${t}SimilarPosts`]: make(who, {
      valid: (s) => ({ query: { title: s.a.postTitle } }),
    }),
    [`getQuills${t}Post`]: make(who, {
      valid: (s) => ({ params: post(s) }),
      foreign: foreignPost,
    }),
    [`createQuills${t}Post`]: make(who, {
      valid: (s) => ({
        body: {
          boardId: s.a.boardId,
          title: "A new idea",
          content: "Details",
          idempotencyKey: s.a.key,
        },
      }),
      foreign: (s) => ({ boardId: s.b.boardId }),
    }),
    [`setQuills${t}Vote`]: make(who, {
      valid: (s) => ({ params: post(s), body: { voted: true } }),
      foreign: foreignPost,
    }),
    [`setQuills${t}Follow`]: make(who, {
      valid: (s) => ({ params: post(s), body: { following: true } }),
      foreign: foreignPost,
    }),
    [`listQuills${t}VotedPosts`]: make(who, { valid: () => ({}) }),
    [`getQuills${t}UserStats`]: make(who, { valid: () => ({}) }),
    [`listQuills${t}PostComments`]: make(who, {
      valid: (s) => ({ params: post(s) }),
      foreign: foreignPost,
    }),
    [`createQuills${t}Comment`]: make(who, {
      valid: (s) => ({
        params: post(s),
        body: {
          content: "A reply",
          parentId: s.a.commentId,
          idempotencyKey: s.a.key,
        },
      }),
      foreign: (s) => ({ postId: s.b.postId, parentId: s.b.commentId }),
    }),
    [`setQuills${t}CommentReaction`]: make(who, {
      valid: (s) => ({
        params: { commentId: s.a.commentId },
        body: { emoji: "👍", reacted: true },
      }),
      foreign: (s) => ({ commentId: s.b.commentId }),
    }),
    [`listQuills${t}Changelog`]: make(who, { valid: () => ({}) }),
    [`getQuills${t}ChangelogEntry`]: make(who, {
      valid: (s) => ({ params: { entryId: s.a.entryId } }),
      foreign: (s) => ({ entryId: s.b.entryId }),
    }),
  };
}

/** The portal-only routes. */
export const portalOnly: Record<string, Fixture> = {
  listQuillsPortalStatuses: make("portal", { valid: () => ({}) }),
  listQuillsPortalTags: make("portal", { valid: () => ({}) }),
  listQuillsPortalRoadmaps: make("portal", { valid: () => ({}) }),
  listQuillsPortalRoadmapPosts: make("portal", {
    valid: (s) => ({
      params: { roadmapId: s.a.roadmapId },
      query: { statusId: s.a.statusId },
    }),
    foreign: (s) => ({ roadmapId: s.b.roadmapId, statusId: s.b.statusId }),
  }),
  editQuillsPortalOwnPost: make("portal", {
    valid: (s) => ({
      params: { postId: s.a.ownPost! },
      body: { title: "Edited", content: "Edited body" },
    }),
    foreign: foreignPost,
  }),
  deleteQuillsPortalOwnPost: make("portal", {
    valid: (s) => ({ params: { postId: s.a.ownPost! } }),
    foreign: foreignPost,
  }),
  editQuillsPortalOwnComment: make("portal", {
    valid: (s) => ({
      params: { commentId: s.a.ownComment! },
      body: { content: "Edited comment" },
    }),
    foreign: (s) => ({ commentId: s.b.commentId }),
  }),
  deleteQuillsPortalOwnComment: make("portal", {
    valid: (s) => ({ params: { commentId: s.a.ownComment! } }),
    foreign: (s) => ({ commentId: s.b.commentId }),
  }),
};

/** Public feeds: what an anonymous visitor of A's public portal sees. */
const publicScene = async (env: Parameters<Fixture["seed"]>[0]) => ({
  a: await world(env, env.a),
  b: await world(env, env.b),
});
export const publicFeeds: Record<string, Fixture> = Object.fromEntries(
  ["getQuillsPublicChangelogFeed", "getQuillsPublicSitemap"].map((id) => [
    id,
    fixture({
      seed: publicScene,
      valid: () => ({}),
      hidden: (s) => [...s.a.hidden, ...s.b.hidden, s.b.postTitle, s.b.postId],
    }),
  ]),
);
