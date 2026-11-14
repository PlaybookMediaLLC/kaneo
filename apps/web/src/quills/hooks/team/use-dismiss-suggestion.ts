import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  dismissSuggestion,
  type DismissSuggestionRequest,
  type DismissSuggestionResponse,
} from "../../api/team/dismiss-suggestion";
export function useDismissSuggestion(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DismissSuggestionResponse,
    PortalProblem,
    DismissSuggestionRequest
  >({
    mutationFn: (input) => dismissSuggestion(input),
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
