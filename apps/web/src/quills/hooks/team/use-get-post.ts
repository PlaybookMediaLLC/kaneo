import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import { getPostQuery, type GetPostRequest } from "../../api/team/get-post";
export function useGetPost(input: GetPostRequest, viewer: Viewer) {
  return useQuery({
    ...getPostQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.postId),
  });
}
