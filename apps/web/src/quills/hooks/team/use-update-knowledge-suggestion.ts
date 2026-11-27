import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  updateKnowledgeSuggestion,
  type UpdateKnowledgeSuggestionRequest,
  type UpdateKnowledgeSuggestionResponse,
} from "../../api/team/update-knowledge-suggestion";
export function useUpdateKnowledgeSuggestion(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateKnowledgeSuggestionResponse,
    PortalProblem,
    UpdateKnowledgeSuggestionRequest
  >({
    mutationFn: (input) => updateKnowledgeSuggestion(input),
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
