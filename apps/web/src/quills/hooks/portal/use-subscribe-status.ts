import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  subscribeStatus,
  type SubscribeStatusRequest,
  type SubscribeStatusResponse,
} from "../../api/portal/subscribe-status";
export function useSubscribeStatus(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SubscribeStatusResponse,
    PortalProblem,
    SubscribeStatusRequest
  >({
    mutationFn: (input) => subscribeStatus(input),
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
