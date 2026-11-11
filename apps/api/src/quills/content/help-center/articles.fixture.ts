import { fixture } from "../../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const byArticle = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { articleId: a.draftId }, body }),
    foreign: ({ b }: Ids) => ({ articleId: b.draftId }),
  });

export const listQuillsHelpCenterArticles = fixture({
  seed,
  valid: () => ({}),
});
export const getQuillsHelpCenterArticle = byArticle();
export const createQuillsHelpCenterArticle = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      title: "Getting started",
      content: "Step one",
      categoryId: a.categoryId,
    },
  }),
  foreign: ({ b }: Ids) => ({ categoryId: b.categoryId }),
});
export const updateQuillsHelpCenterArticle = byArticle({
  title: "Renamed",
  published: true,
});
export const deleteQuillsHelpCenterArticle = byArticle();
export const restoreQuillsHelpCenterArticle = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { articleId: a.deletedArticleId } }),
  foreign: ({ b }: Ids) => ({ articleId: b.deletedArticleId }),
});
export const reorderQuillsHelpCenterArticles = fixture({
  seed,
  // The category's live articles; the deleted one is not part of the order.
  valid: ({ a }: Ids) => ({
    params: { categoryId: a.categoryId },
    body: { articleIds: [a.draftId, a.articleId] },
  }),
  foreign: ({ b }: Ids) => ({ categoryId: b.categoryId }),
});
