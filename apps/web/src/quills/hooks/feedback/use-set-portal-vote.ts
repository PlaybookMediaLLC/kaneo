import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPortalVote,
  type SetPortalVoteRequest,
  type SetPortalVoteResponse,
} from "../../api/feedback/set-portal-vote";
export function useSetPortalVote(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetPortalVoteResponse,
    PortalProblem,
    SetPortalVoteRequest
  >({
    mutationFn: (input) => setPortalVote(input),
    onSuccess: async (_data, input) => {
      // The refreshes are independent, so they run together.
      await Promise.all(
        [
          "listPortalPosts",
          "getPortalPost",
          "listPortalRoadmapPosts",
          "listPortalVotedPosts",
        ].map((operation) =>
          queryClient.invalidateQueries({
            queryKey: quillsOperationKey(
              input.param.workspace,
              viewer,
              "feedback",
              operation,
            ),
          }),
        ),
      );
    },
  });
}
