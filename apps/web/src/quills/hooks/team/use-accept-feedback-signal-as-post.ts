import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  acceptFeedbackSignalAsPost,
  type AcceptFeedbackSignalAsPostRequest,
  type AcceptFeedbackSignalAsPostResponse,
} from "../../api/team/accept-feedback-signal-as-post";
export function useAcceptFeedbackSignalAsPost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AcceptFeedbackSignalAsPostResponse,
    PortalProblem,
    AcceptFeedbackSignalAsPostRequest
  >({
    mutationFn: (input) => acceptFeedbackSignalAsPost(input),
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
