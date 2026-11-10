import { fixture } from "../../framework/contract";
import { seed, type Ids } from "./seed.fixture";

export const listQuillsHelpCenterRedirectRules = fixture({
  seed,
  valid: () => ({}),
});
export const createQuillsHelpCenterRedirectRule = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      path: `/moved/${a.draftId}`,
      targetType: "article",
      targetId: a.articleId,
    },
  }),
  foreign: ({ b }: Ids) => ({ targetId: b.articleId }),
});
export const deleteQuillsHelpCenterRedirectRule = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { ruleId: a.ruleId } }),
  foreign: ({ b }: Ids) => ({ ruleId: b.ruleId }),
});
