import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPostFactorScores,
  type SetPostFactorScoresRequest,
  type SetPostFactorScoresResponse,
} from "../../api/team/set-post-factor-scores";
export function useSetPostFactorScores(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetPostFactorScoresResponse,
    PortalProblem,
    SetPostFactorScoresRequest
  >({
    mutationFn: (input) => setPostFactorScores(input),
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
      ]);
    },
  });
}
