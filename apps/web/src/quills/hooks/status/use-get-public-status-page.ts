import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicStatusPageQuery,
  type GetPublicStatusPageRequest,
} from "../../api/status/get-public-status-page";
export function useGetPublicStatusPage(
  input: GetPublicStatusPageRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicStatusPageQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
