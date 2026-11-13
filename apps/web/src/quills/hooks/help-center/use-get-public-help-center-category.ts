import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicHelpCenterCategoryQuery,
  type GetPublicHelpCenterCategoryRequest,
} from "../../api/help-center/get-public-help-center-category";
export function useGetPublicHelpCenterCategory(
  input: GetPublicHelpCenterCategoryRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicHelpCenterCategoryQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.categorySlug),
  });
}
