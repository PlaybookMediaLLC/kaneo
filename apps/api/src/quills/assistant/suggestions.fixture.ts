import { eq } from "drizzle-orm";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { fixture } from "../framework/contract";
import { seedPosts, type PostIds } from "./seed.fixture";

const onPost = fixture({
  seed: seedPosts,
  valid: ({ a }: PostIds) => ({ params: { postId: a.postId } }),
  foreign: ({ b }: PostIds) => ({ postId: b.postId }),
});
const onSuggestion = (body?: object, dismissed = false) =>
  fixture({
    seed: async (env) => {
      const ids = await seedPosts(env);
      if (dismissed)
        for (const [workspaceId, side] of [
          [env.a, ids.a],
          [env.b, ids.b],
        ] as const)
          await env.scoped(workspaceId, (db) =>
            db
              .update(mergeSuggestions)
              .set({ status: "dismissed" })
              .where(eq(mergeSuggestions.id, side.suggestionId)),
          );
      return ids;
    },
    valid: ({ a }: PostIds) => ({
      params: { suggestionId: a.suggestionId },
      ...(body && { body }),
    }),
    foreign: ({ b }: PostIds) => ({ suggestionId: b.suggestionId }),
  });

export const getQuillsMergeSuggestionsForPost = onPost;
export const listQuillsMergeSuggestions = fixture({
  seed: seedPosts,
  valid: () => ({ query: { status: "pending" } }),
});
export const fetchQuillsMergeSuggestionSummary = fixture({
  seed: seedPosts,
  valid: () => ({}),
});
export const fetchQuillsMergeSuggestionCountsForPosts = fixture({
  seed: seedPosts,
  valid: ({ a }: PostIds) => ({
    query: { postIds: `${a.postId},${a.otherPostId}` },
  }),
});
export const acceptQuillsSuggestion = onSuggestion({ swapDirection: false });
export const dismissQuillsSuggestion = onSuggestion();
export const restoreQuillsSuggestion = onSuggestion(undefined, true);
export const retryQuillsPostMergeCheck = onPost;
