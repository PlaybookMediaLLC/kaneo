import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listConversationTagsQuery,
  type ListConversationTagsRequest,
} from "../../api/team/list-conversation-tags";
export function useListConversationTags(
  input: ListConversationTagsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listConversationTagsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
