import { fixture } from "../framework/contract";
import { seed, type Ids } from "./seed.fixture";

// A board of B in the filter must be 404. insights.test.ts checks the counts.
export const getQuillsFeedbackInsights = fixture({
  seed,
  valid: ({ a }: Ids) => ({ query: { boardId: a.boardId } }),
  foreign: ({ b }: Ids) => ({ boardId: b.boardId }),
});
