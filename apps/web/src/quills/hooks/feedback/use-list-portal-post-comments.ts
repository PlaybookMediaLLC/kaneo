import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalPostCommentsQuery,
  type ListPortalPostCommentsRequest,
} from "../../api/feedback/list-portal-post-comments";
export function useListPortalPostComments(
  input: ListPortalPostCommentsRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listPortalPostCommentsQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.postId),
  });
}
