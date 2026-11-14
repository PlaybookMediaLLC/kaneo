import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPortalActiveSurveyQuery,
  type GetPortalActiveSurveyRequest,
} from "../../api/feedback/get-portal-active-survey";
export function useGetPortalActiveSurvey(
  input: GetPortalActiveSurveyRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPortalActiveSurveyQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
