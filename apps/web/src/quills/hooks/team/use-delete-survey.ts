import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  deleteSurvey,
  type DeleteSurveyRequest,
  type DeleteSurveyResponse,
} from "../../api/team/delete-survey";
export function useDeleteSurvey(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<DeleteSurveyResponse, PortalProblem, DeleteSurveyRequest>({
    mutationFn: (input) => deleteSurvey(input),
    // The deleted survey's results are not read again: that read is a 404.
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listSurveys",
        ),
      });
    },
  });
}
