import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  dismissKnowledgeSuggestion,
  type DismissKnowledgeSuggestionRequest,
  type DismissKnowledgeSuggestionResponse,
} from "../../api/team/dismiss-knowledge-suggestion";
export function useDismissKnowledgeSuggestion(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DismissKnowledgeSuggestionResponse,
    PortalProblem,
    DismissKnowledgeSuggestionRequest
  >({
    mutationFn: (input) => dismissKnowledgeSuggestion(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listKnowledgeSuggestions",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getKnowledgeSuggestion",
          ),
        }),
      ]);
    },
  });
}
