import { fixture } from "../../framework/contract";
import { seed, type Ids } from "./seed.fixture";

export const recordQuillsHelpCenterArticleFeedback = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { articleId: a.articleId },
    body: { helpful: true },
  }),
  foreign: ({ b }: Ids) => ({ articleId: b.articleId }),
});
export const listQuillsHelpCenterArticleFeedbackReasons = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { articleId: a.articleId } }),
  foreign: ({ b }: Ids) => ({ articleId: b.articleId }),
});
export const listQuillsHelpCenterArticlePerformance = fixture({
  seed,
  valid: () => ({}),
});
export const listQuillsHelpCenterSearchTerms = fixture({
  seed,
  valid: () => ({}),
});
