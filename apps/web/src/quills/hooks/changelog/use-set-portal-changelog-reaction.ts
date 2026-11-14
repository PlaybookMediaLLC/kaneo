import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPortalChangelogReaction,
  type SetPortalChangelogReactionRequest,
  type SetPortalChangelogReactionResponse,
} from "../../api/changelog/set-portal-changelog-reaction";
export function useSetPortalChangelogReaction(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetPortalChangelogReactionResponse,
    PortalProblem,
    SetPortalChangelogReactionRequest
  >({
    mutationFn: (input) => setPortalChangelogReaction(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "changelog",
          "listPortalChangelog",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "changelog",
          "getPortalChangelogEntry",
        ),
      });
    },
  });
}
