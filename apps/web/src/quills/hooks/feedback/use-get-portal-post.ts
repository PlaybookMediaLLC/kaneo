import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPortalPostQuery,
  type GetPortalPostRequest,
} from "../../api/feedback/get-portal-post";
export function useGetPortalPost(input: GetPortalPostRequest, viewer: Viewer) {
  return useQuery({
    ...getPortalPostQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.postId),
  });
}
