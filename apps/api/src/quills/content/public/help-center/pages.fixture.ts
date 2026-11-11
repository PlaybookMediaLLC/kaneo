import { fixture, type ContractInput } from "../../../framework/contract";
import { helpSeed, type HelpIds } from "../seed.fixture";

// Public reads: no customer owns the result, so `own` is empty on purpose.
const read = (
  valid: (ids: HelpIds) => ContractInput,
  foreign?: (ids: HelpIds) => Record<string, string>,
) =>
  fixture({
    seed: helpSeed,
    valid,
    foreign,
    hidden: (ids: HelpIds) => ids.hidden,
    own: () => [],
  });

const idSlug = ({ urlId, slug }: { urlId: number; slug: string }) =>
  `${urlId}-${slug}`;

// German: the translated catalogue must leave out drafts and draft translations too.
export const getQuillsPublicHelpCenter = read(() => ({
  query: { locale: "de" },
}));
export const getQuillsPublicHelpCenterCategory = read(
  ({ a }) => ({ params: { categorySlug: a.category.slug } }),
  ({ b }) => ({ categorySlug: b.category.slug }),
);
export const getQuillsPublicHelpCenterCollection = read(
  ({ a }) => ({ params: { idSlug: idSlug(a.category) } }),
  ({ b }) => ({ idSlug: idSlug(b.category) }),
);
export const getQuillsPublicHelpCenterArticle = read(
  ({ a }) => ({ params: { idSlug: idSlug(a.published) } }),
  ({ b }) => ({ idSlug: idSlug(b.published) }),
);
export const listQuillsPublicHelpCenterCategoryArticles = read(
  ({ a }) => ({ params: { categoryId: a.category.id } }),
  ({ b }) => ({ categoryId: b.category.id }),
);
// The response holds category IDs: the private and gated categories must not be among them.
export const listQuillsPublicHelpCenterEditors = fixture({
  seed: helpSeed,
  valid: () => ({}),
  hidden: (ids) => [...ids.hidden, ...ids.a.closedCategoryIds],
  own: () => [],
});
export const resolveQuillsPublicHelpCenterRedirect = read(({ a }) => ({
  query: { path: a.redirectPath },
}));
