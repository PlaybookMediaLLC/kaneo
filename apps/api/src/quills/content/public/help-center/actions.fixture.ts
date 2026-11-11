import { and, eq } from "drizzle-orm";
import { helpCenterArticleFeedback } from "../../../../database/quills/schema/kb";
import { fixture, type ContractEnv } from "../../../framework/contract";
import { helpSeed, type HelpIds } from "../seed.fixture";

// Fixtures for the search, vote, reason and sitemap routes.

/** Customer A's votes on the seeded article: another caller's request must not change them. */
const votesOf =
  (env: ContractEnv) =>
  ({ a, customer }: HelpIds & { customer: { principalId: string } }) =>
    env.scoped(env.a, (db) =>
      db
        .select({
          id: helpCenterArticleFeedback.id,
          helpful: helpCenterArticleFeedback.helpful,
          reason: helpCenterArticleFeedback.reason,
        })
        .from(helpCenterArticleFeedback)
        .where(
          and(
            eq(helpCenterArticleFeedback.articleId, a.published.id),
            eq(
              helpCenterArticleFeedback.principalId,
              customer.principalId as never,
            ),
          ),
        ),
    );

const withCustomer = async (env: ContractEnv) => ({
  ...(await helpSeed(env)),
  customer: await env.portalCustomer(env.a, env.customerA),
});

export const searchQuillsPublicHelpCenter = fixture({
  seed: helpSeed,
  // The label holds underscores: the title match must take them literally.
  valid: ({ a }) => ({ body: { query: a.label } }),
  hidden: (ids) => ids.hidden,
  own: () => [],
});

export const recordQuillsPublicArticleFeedback = fixture({
  seed: withCustomer,
  valid: ({ a }) => ({
    params: { articleId: a.published.id },
    body: { helpful: true },
  }),
  foreign: ({ b }) => ({ articleId: b.published.id }),
  hidden: (ids) => ids.hidden,
  own: () => [],
  probe: (env, ids) => votesOf(env)(ids),
});

export const submitQuillsPublicArticleFeedbackReason = fixture({
  seed: async (env) => {
    const ids = await withCustomer(env);
    const [mine] = await env.scoped(env.a, (db) =>
      db
        .insert(helpCenterArticleFeedback)
        .values({
          articleId: ids.a.published.id,
          principalId: ids.customer.principalId as never,
          helpful: false,
        })
        .returning({ id: helpCenterArticleFeedback.id }),
    );
    return { ...ids, mine: mine!.id };
  },
  valid: ({ mine }) => ({
    params: { feedbackId: mine },
    body: { reason: "A step is missing" },
  }),
  foreign: ({ b }) => ({ feedbackId: b.voteId }),
  hidden: (ids) => ids.hidden,
  own: () => [],
  probe: (env, ids) => votesOf(env)(ids),
});

export const getQuillsPublicHelpCenterSitemap = fixture({
  seed: helpSeed,
  valid: () => ({}),
  hidden: ({ a, b }) => [...a.hiddenPaths, b.published.slug],
  own: () => [],
});
