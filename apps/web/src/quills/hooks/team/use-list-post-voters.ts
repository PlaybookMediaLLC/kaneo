import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPostVotersInfiniteQuery,
  type ListPostVotersRequest,
} from "../../api/team/list-post-voters";
export function useListPostVoters(
  input: ListPostVotersRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listPostVotersInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.postId),
  });
}
