import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setScoringFactors,
  type SetScoringFactorsRequest,
  type SetScoringFactorsResponse,
} from "../../api/team/set-scoring-factors";
export function useSetScoringFactors(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetScoringFactorsResponse,
    PortalProblem,
    SetScoringFactorsRequest
  >({
    mutationFn: (input) => setScoringFactors(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getScoringFactors",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPosts",
          ),
        }),
      ]);
    },
  });
}
