import { fixture } from "../framework/contract";
import { germanEnabled } from "../content/help-center/seed.fixture";
import { on, seedFor } from "./seed.fixture";

const translate = on(
  ["article"],
  (a) => ({ params: { articleId: a.articleId }, body: { locale: "de" } }),
  (b) => ({ articleId: b.articleId }),
);
export const requestQuillsArticleTranslation = {
  ...translate,
  seed: async (env: Parameters<typeof translate.seed>[0], caller: string) => {
    await germanEnabled(env);
    return translate.seed(env, caller);
  },
};
export const searchQuillsHelpCenterSemantic = fixture({
  seed: seedFor("article"),
  valid: () => ({ body: { query: "refund", limit: 5 } }),
});
