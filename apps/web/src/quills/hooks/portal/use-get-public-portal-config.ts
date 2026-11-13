import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicPortalConfigQuery,
  type GetPublicPortalConfigRequest,
} from "../../api/portal/get-public-portal-config";
export function useGetPublicPortalConfig(
  input: GetPublicPortalConfigRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicPortalConfigQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
