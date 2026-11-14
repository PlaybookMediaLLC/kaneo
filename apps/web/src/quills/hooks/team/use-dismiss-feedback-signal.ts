import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  dismissFeedbackSignal,
  type DismissFeedbackSignalRequest,
  type DismissFeedbackSignalResponse,
} from "../../api/team/dismiss-feedback-signal";
export function useDismissFeedbackSignal(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DismissFeedbackSignalResponse,
    PortalProblem,
    DismissFeedbackSignalRequest
  >({
    mutationFn: (input) => dismissFeedbackSignal(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listFeedbackSignals",
        ),
      });
    },
  });
}
