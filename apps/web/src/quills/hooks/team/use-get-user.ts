import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import { getUserQuery, type GetUserRequest } from "../../api/team/get-user";
export function useGetUser(input: GetUserRequest, viewer: Viewer) {
  return useQuery({
    ...getUserQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.principalId),
  });
}
