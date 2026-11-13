import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicHelpCenterQuery,
  type GetPublicHelpCenterRequest,
} from "../../api/help-center/get-public-help-center";
export function useGetPublicHelpCenter(
  input: GetPublicHelpCenterRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicHelpCenterQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
