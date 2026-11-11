import { fixture, type ContractInput } from "../../framework/contract";
import { helpSeed, type HelpIds } from "../../content/public/seed.fixture";

// The valid caller is an identified widget visitor, so the reads also cover the session path.
type Ids = HelpIds & { token: string };
const seed = async (env: Parameters<typeof helpSeed>[0]): Promise<Ids> => {
  const ids = await helpSeed(env);
  return { ...ids, token: (await env.widgetVisitor(env.a)).token };
};
const help = (
  valid: (ids: Ids) => Omit<ContractInput, "bearer">,
  foreign?: (ids: Ids) => Record<string, string>,
) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({ ...valid(ids), bearer: ids.token }),
    foreign,
    hidden: (ids: Ids) => ids.hidden,
  });

export const listQuillsWidgetHelpCategories = help(() => ({
  query: { locale: "de" },
}));
export const listQuillsWidgetHelpArticles = help(
  ({ a }) => ({ query: { categoryId: a.category.id } }),
  ({ b }) => ({ categoryId: b.category.id }),
);
export const getQuillsWidgetHelpArticle = help(
  ({ a }) => ({ params: { ref: a.published.id } }),
  ({ b }) => ({ ref: b.published.id }),
);
export const setQuillsWidgetHelpArticleFeedback = help(
  ({ a }) => ({
    params: { articleId: a.published.id },
    body: { helpful: true },
  }),
  ({ b }) => ({ articleId: b.published.id }),
);
export const searchQuillsWidgetHelp = help(({ a }) => ({
  body: { query: a.label, locale: "de" },
}));
