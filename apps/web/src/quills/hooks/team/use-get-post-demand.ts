import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPostDemandQuery,
  type GetPostDemandRequest,
} from "../../api/team/get-post-demand";
export function useGetPostDemand(input: GetPostDemandRequest, viewer: Viewer) {
  return useQuery({
    ...getPostDemandQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.postId),
  });
}
