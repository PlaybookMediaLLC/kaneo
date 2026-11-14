import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  restoreFeedbackSignal,
  type RestoreFeedbackSignalRequest,
  type RestoreFeedbackSignalResponse,
} from "../../api/team/restore-feedback-signal";
export function useRestoreFeedbackSignal(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RestoreFeedbackSignalResponse,
    PortalProblem,
    RestoreFeedbackSignalRequest
  >({
    mutationFn: (input) => restoreFeedbackSignal(input),
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
