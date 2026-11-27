import { fixture } from "../framework/contract";
import { seed } from "./seed.fixture";

export const findQuillsSimilarPosts = fixture({
  seed,
  valid: () => ({ query: { q: "dark mode" } }),
});

export const getQuillsFeedbackHygiene = fixture({
  seed,
  valid: () => ({ query: { staleDays: "30" } }),
});
