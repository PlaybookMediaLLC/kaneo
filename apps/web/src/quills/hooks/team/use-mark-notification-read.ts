import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  markNotificationRead,
  type MarkNotificationReadRequest,
  type MarkNotificationReadResponse,
} from "../../api/team/mark-notification-read";
export function useMarkNotificationRead(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    MarkNotificationReadResponse,
    PortalProblem,
    MarkNotificationReadRequest
  >({
    mutationFn: (input) => markNotificationRead(input),
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
