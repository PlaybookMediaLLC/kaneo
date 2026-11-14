import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  restoreSuggestion,
  type RestoreSuggestionRequest,
  type RestoreSuggestionResponse,
} from "../../api/team/restore-suggestion";
export function useRestoreSuggestion(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RestoreSuggestionResponse,
    PortalProblem,
    RestoreSuggestionRequest
  >({
    mutationFn: (input) => restoreSuggestion(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listMergeSuggestions",
        ),
      });
    },
  });
}
