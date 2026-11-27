import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  answerKnowledgeSuggestion,
  type AnswerKnowledgeSuggestionRequest,
  type AnswerKnowledgeSuggestionResponse,
} from "../../api/team/answer-knowledge-suggestion";
export function useAnswerKnowledgeSuggestion(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AnswerKnowledgeSuggestionResponse,
    PortalProblem,
    AnswerKnowledgeSuggestionRequest
  >({
    mutationFn: (input) => answerKnowledgeSuggestion(input),
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
