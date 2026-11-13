import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicHelpCenterArticleQuery,
  type GetPublicHelpCenterArticleRequest,
} from "../../api/help-center/get-public-help-center-article";
export function useGetPublicHelpCenterArticle(
  input: GetPublicHelpCenterArticleRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicHelpCenterArticleQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.idSlug),
  });
}
