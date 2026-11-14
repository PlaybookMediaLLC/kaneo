import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  addConversationNote,
  type AddConversationNoteRequest,
  type AddConversationNoteResponse,
} from "../../api/team/add-conversation-note";
export function useAddConversationNote(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AddConversationNoteResponse,
    PortalProblem,
    AddConversationNoteRequest
  >({
    mutationFn: (input) => addConversationNote(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listConversationMessages",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getConversation",
        ),
      });
    },
  });
}
