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
export const recordQuillsWidgetHelpSearchClick = fixture({
  seed: async (env) => {
    const ids = await seed(env);
    const { helpCenterSearchQueries } =
      await import("../../../database/quills/schema/kb");
    const [qa] = await env.scoped(env.a, (db) =>
      db
        .insert(helpCenterSearchQueries)
        .values({
          query: ids.a.label,
          normalizedQuery: ids.a.label.toLowerCase(),
          locale: "en",
          resultsCount: 1,
        })
        .returning({ id: helpCenterSearchQueries.id }),
    );
    const [qb] = await env.scoped(env.b, (db) =>
      db
        .insert(helpCenterSearchQueries)
        .values({
          query: ids.b.label,
          normalizedQuery: ids.b.label.toLowerCase(),
          locale: "en",
          resultsCount: 1,
        })
        .returning({ id: helpCenterSearchQueries.id }),
    );
    return { ...ids, queryA: qa!.id, queryB: qb!.id };
  },
  valid: (ids) => ({
    bearer: ids.token,
    params: { queryId: ids.queryA },
    body: { articleId: ids.a.published.id },
  }),
  foreign: (ids) => ({
    queryId: ids.queryB,
    articleId: ids.b.published.id,
  }),
  hidden: (ids) => ids.hidden,
});
