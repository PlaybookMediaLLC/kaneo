import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  suggestTicketFieldValues,
  type SuggestTicketFieldValuesRequest,
  type SuggestTicketFieldValuesResponse,
} from "../../api/team/suggest-ticket-field-values";
export function useSuggestTicketFieldValues(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SuggestTicketFieldValuesResponse,
    PortalProblem,
    SuggestTicketFieldValuesRequest
  >({
    mutationFn: (input) => suggestTicketFieldValues(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getAssistantRun",
        ),
      });
    },
  });
}
