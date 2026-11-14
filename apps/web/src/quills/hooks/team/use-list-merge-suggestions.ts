import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listMergeSuggestionsInfiniteQuery,
  type ListMergeSuggestionsRequest,
} from "../../api/team/list-merge-suggestions";
export function useListMergeSuggestions(
  input: ListMergeSuggestionsRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listMergeSuggestionsInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
