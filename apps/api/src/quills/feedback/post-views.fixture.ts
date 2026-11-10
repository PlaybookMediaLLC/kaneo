import { fixture } from "../framework/contract";
import { byParam, feedbackSeed } from "./seeds.fixture";

export const listQuillsPostViews = fixture({
  seed: feedbackSeed,
  valid: () => ({}),
});
export const createQuillsPostView = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { name: "Top requests", filters: { sort: "votes", minVotes: 5 } },
  }),
});
export const deleteQuillsPostView = byParam("viewId", (s) => s.viewId);
