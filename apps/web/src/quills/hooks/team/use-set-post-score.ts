import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPostScore,
  type SetPostScoreRequest,
  type SetPostScoreResponse,
} from "../../api/team/set-post-score";
export function useSetPostScore(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<SetPostScoreResponse, PortalProblem, SetPostScoreRequest>({
    mutationFn: (input) => setPostScore(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listPosts",
        ),
      });
    },
  });
}
