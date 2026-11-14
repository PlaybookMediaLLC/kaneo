import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  acceptFeedbackSignalAsVote,
  type AcceptFeedbackSignalAsVoteRequest,
  type AcceptFeedbackSignalAsVoteResponse,
} from "../../api/team/accept-feedback-signal-as-vote";
export function useAcceptFeedbackSignalAsVote(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AcceptFeedbackSignalAsVoteResponse,
    PortalProblem,
    AcceptFeedbackSignalAsVoteRequest
  >({
    mutationFn: (input) => acceptFeedbackSignalAsVote(input),
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
