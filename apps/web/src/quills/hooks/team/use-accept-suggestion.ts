import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  acceptSuggestion,
  type AcceptSuggestionRequest,
  type AcceptSuggestionResponse,
} from "../../api/team/accept-suggestion";
export function useAcceptSuggestion(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AcceptSuggestionResponse,
    PortalProblem,
    AcceptSuggestionRequest
  >({
    mutationFn: (input) => acceptSuggestion(input),
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
