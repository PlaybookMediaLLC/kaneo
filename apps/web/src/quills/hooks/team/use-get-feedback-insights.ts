import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getFeedbackInsightsQuery,
  type GetFeedbackInsightsRequest,
} from "../../api/team/get-feedback-insights";
export function useGetFeedbackInsights(
  input: GetFeedbackInsightsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getFeedbackInsightsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
