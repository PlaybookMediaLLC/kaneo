import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listFeedbackSignalsInfiniteQuery,
  type ListFeedbackSignalsRequest,
} from "../../api/team/list-feedback-signals";
export function useListFeedbackSignals(
  input: ListFeedbackSignalsRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listFeedbackSignalsInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
