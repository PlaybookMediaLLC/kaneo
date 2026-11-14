import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listConversationViewsQuery,
  type ListConversationViewsRequest,
} from "../../api/team/list-conversation-views";
export function useListConversationViews(
  input: ListConversationViewsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listConversationViewsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
