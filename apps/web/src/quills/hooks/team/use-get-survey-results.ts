import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getSurveyResultsQuery,
  type GetSurveyResultsRequest,
} from "../../api/team/get-survey-results";
export function useGetSurveyResults(
  input: GetSurveyResultsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getSurveyResultsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.surveyId),
  });
}
