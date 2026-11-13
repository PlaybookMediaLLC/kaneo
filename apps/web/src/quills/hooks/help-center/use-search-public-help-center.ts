import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  searchPublicHelpCenterQuery,
  type SearchPublicHelpCenterRequest,
} from "../../api/help-center/search-public-help-center";
export function useSearchPublicHelpCenter(
  input: SearchPublicHelpCenterRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...searchPublicHelpCenterQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.json.query.trim()),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}
