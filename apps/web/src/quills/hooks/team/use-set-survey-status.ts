import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setSurveyStatus,
  type SetSurveyStatusRequest,
  type SetSurveyStatusResponse,
} from "../../api/team/set-survey-status";
export function useSetSurveyStatus(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetSurveyStatusResponse,
    PortalProblem,
    SetSurveyStatusRequest
  >({
    mutationFn: (input) => setSurveyStatus(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "listSurveys",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getSurveyResults",
        ),
      });
    },
  });
}
