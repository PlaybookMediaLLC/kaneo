import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  recordPublicArticleFeedback,
  type RecordPublicArticleFeedbackRequest,
  type RecordPublicArticleFeedbackResponse,
} from "../../api/help-center/record-public-article-feedback";
export function useRecordPublicArticleFeedback(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RecordPublicArticleFeedbackResponse,
    PortalProblem,
    RecordPublicArticleFeedbackRequest
  >({
    mutationFn: (input) => recordPublicArticleFeedback(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "help-center",
          "getPublicHelpCenterArticle",
        ),
      });
    },
  });
}
