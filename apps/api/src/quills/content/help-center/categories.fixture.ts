import { fixture } from "../../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const byCategory = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { categoryId: a.categoryId }, body }),
    foreign: ({ b }: Ids) => ({ categoryId: b.categoryId }),
  });

export const listQuillsHelpCenterCategories = fixture({
  seed,
  valid: () => ({}),
});
export const getQuillsHelpCenterCategory = byCategory();
export const createQuillsHelpCenterCategory = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: { name: `Guides ${a.categoryId}`, parentId: a.categoryId },
  }),
  foreign: ({ b }: Ids) => ({ parentId: b.categoryId }),
});
export const updateQuillsHelpCenterCategory = byCategory({ name: "Renamed" });
export const deleteQuillsHelpCenterCategory = byCategory();
export const restoreQuillsHelpCenterCategory = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { categoryId: a.deletedCategoryId } }),
  foreign: ({ b }: Ids) => ({ categoryId: b.deletedCategoryId }),
});
export const reorderQuillsHelpCenterCategories = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: { parentId: a.categoryId, categoryIds: [...a.childIds].reverse() },
  }),
  foreign: ({ b }: Ids) => ({ parentId: b.categoryId }),
});
