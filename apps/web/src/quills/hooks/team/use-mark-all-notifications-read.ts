import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  markAllNotificationsRead,
  type MarkAllNotificationsReadRequest,
  type MarkAllNotificationsReadResponse,
} from "../../api/team/mark-all-notifications-read";
export function useMarkAllNotificationsRead(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    MarkAllNotificationsReadResponse,
    PortalProblem,
    MarkAllNotificationsReadRequest
  >({
    mutationFn: (input) => markAllNotificationsRead(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listNotifications",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getNotificationUnreadCount",
        ),
      });
    },
  });
}
