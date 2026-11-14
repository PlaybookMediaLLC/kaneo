import { fixture } from "../framework/contract";
import { seedPosts } from "../assistant/seed.fixture";

// A pending merge suggestion on each side, so the duplicate count has a row to filter.
export const getQuillsTeamCounts = fixture({
  seed: seedPosts,
  valid: () => ({}),
});
