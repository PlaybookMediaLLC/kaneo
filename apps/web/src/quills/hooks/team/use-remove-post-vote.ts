import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  removePostVote,
  type RemovePostVoteRequest,
  type RemovePostVoteResponse,
} from "../../api/team/remove-post-vote";
export function useRemovePostVote(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RemovePostVoteResponse,
    PortalProblem,
    RemovePostVoteRequest
  >({
    mutationFn: (input) => removePostVote(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPosts",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getPost",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getTeamCounts",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPostVoters",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getPostDemand",
          ),
        }),
      ]);
    },
  });
}
