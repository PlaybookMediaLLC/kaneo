import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  submitPortalSurveyResponse,
  type SubmitPortalSurveyResponseRequest,
  type SubmitPortalSurveyResponseResponse,
} from "../../api/feedback/submit-portal-survey-response";
export function useSubmitPortalSurveyResponse(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SubmitPortalSurveyResponseResponse,
    PortalProblem,
    SubmitPortalSurveyResponseRequest
  >({
    mutationFn: (input) => submitPortalSurveyResponse(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "feedback",
          "getPortalActiveSurvey",
        ),
      });
    },
  });
}
