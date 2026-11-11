import { fixture } from "../../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const onArticle = (extra: (ids: Ids) => object = () => ({})) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({
      params: { articleId: ids.a.articleId },
      ...extra(ids),
    }),
    foreign: ({ b }: Ids) => ({ articleId: b.articleId }),
  });
const onCategory = (extra: (ids: Ids) => object = () => ({})) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({
      params: { categoryId: ids.a.categoryId },
      ...extra(ids),
    }),
    foreign: ({ b }: Ids) => ({ categoryId: b.categoryId }),
  });

export const listQuillsHelpCenterArticleTranslations = onArticle();
export const saveQuillsHelpCenterArticleTranslation = onArticle(() => ({
  body: { locale: "fr", title: "Contrat", content: "Contrat" },
}));
export const setQuillsHelpCenterArticleTranslationStatus = onArticle(() => ({
  body: { locale: "de", status: "published" },
}));
export const deleteQuillsHelpCenterArticleTranslation = onArticle(() => ({
  query: { locale: "de" },
}));
export const listQuillsHelpCenterCategoryTranslations = onCategory();
export const saveQuillsHelpCenterCategoryTranslation = onCategory(() => ({
  body: { locale: "fr", name: "Contrat" },
}));
export const deleteQuillsHelpCenterCategoryTranslation = onCategory(() => ({
  query: { locale: "de" },
}));
