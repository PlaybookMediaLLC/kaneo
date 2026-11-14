import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listConversationAttributesQuery,
  type ListConversationAttributesRequest,
} from "../../api/team/list-conversation-attributes";
export function useListConversationAttributes(
  input: ListConversationAttributesRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listConversationAttributesQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
