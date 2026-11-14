import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listNotificationsQuery,
  type ListNotificationsRequest,
} from "../../api/team/list-notifications";
export function useListNotifications(
  input: ListNotificationsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listNotificationsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
