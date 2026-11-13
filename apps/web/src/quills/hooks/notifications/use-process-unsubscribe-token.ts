import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  processUnsubscribeToken,
  type ProcessUnsubscribeTokenRequest,
  type ProcessUnsubscribeTokenResponse,
} from "../../api/notifications/process-unsubscribe-token";
export function useProcessUnsubscribeToken(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    ProcessUnsubscribeTokenResponse,
    PortalProblem,
    ProcessUnsubscribeTokenRequest
  >({
    mutationFn: (input) => processUnsubscribeToken(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "notifications",
          "previewUnsubscribeToken",
        ),
      });
    },
  });
}
