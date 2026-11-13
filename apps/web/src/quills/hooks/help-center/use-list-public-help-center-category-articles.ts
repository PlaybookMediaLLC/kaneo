import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPublicHelpCenterCategoryArticlesQuery,
  type ListPublicHelpCenterCategoryArticlesRequest,
} from "../../api/help-center/list-public-help-center-category-articles";
export function useListPublicHelpCenterCategoryArticles(
  input: ListPublicHelpCenterCategoryArticlesRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listPublicHelpCenterCategoryArticlesQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.categoryId),
  });
}
