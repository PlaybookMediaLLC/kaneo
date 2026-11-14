import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getUserCompanyQuery,
  type GetUserCompanyRequest,
} from "../../api/team/get-user-company";
export function useGetUserCompany(
  input: GetUserCompanyRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getUserCompanyQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.principalId),
  });
}
