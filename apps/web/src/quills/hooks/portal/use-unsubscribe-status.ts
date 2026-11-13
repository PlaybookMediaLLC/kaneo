import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  unsubscribeStatus,
  type UnsubscribeStatusRequest,
  type UnsubscribeStatusResponse,
} from "../../api/portal/unsubscribe-status";
export function useUnsubscribeStatus(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UnsubscribeStatusResponse,
    PortalProblem,
    UnsubscribeStatusRequest
  >({
    mutationFn: (input) => unsubscribeStatus(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "getMyStatusSubscription",
        ),
      });
    },
  });
}
