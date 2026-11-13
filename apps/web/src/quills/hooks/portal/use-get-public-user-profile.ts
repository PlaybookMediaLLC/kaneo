import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPublicUserProfileQuery,
  type GetPublicUserProfileRequest,
} from "../../api/portal/get-public-user-profile";
export function useGetPublicUserProfile(
  input: GetPublicUserProfileRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPublicUserProfileQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.principalId),
  });
}
