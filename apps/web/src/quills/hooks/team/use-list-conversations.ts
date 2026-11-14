import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listConversationsInfiniteQuery,
  type ListConversationsRequest,
} from "../../api/team/list-conversations";
export function useListConversations(
  input: ListConversationsRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listConversationsInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
