import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createSurvey,
  type CreateSurveyRequest,
  type CreateSurveyResponse,
} from "../../api/team/create-survey";
export function useCreateSurvey(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<CreateSurveyResponse, PortalProblem, CreateSurveyRequest>({
    mutationFn: (input) => createSurvey(input),
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
