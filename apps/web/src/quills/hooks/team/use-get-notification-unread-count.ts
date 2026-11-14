import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getNotificationUnreadCountQuery,
  type GetNotificationUnreadCountRequest,
} from "../../api/team/get-notification-unread-count";
export function useGetNotificationUnreadCount(
  input: GetNotificationUnreadCountRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getNotificationUnreadCountQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
