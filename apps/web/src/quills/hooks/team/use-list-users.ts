import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listUsersQuery,
  type ListUsersRequest,
} from "../../api/team/list-users";
export function useListUsers(input: ListUsersRequest, viewer: Viewer) {
  return useQuery({
    ...listUsersQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
