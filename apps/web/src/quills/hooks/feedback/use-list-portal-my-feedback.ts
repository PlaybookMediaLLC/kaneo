import { useInfiniteQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPortalMyFeedbackInfiniteQuery,
  type ListPortalMyFeedbackRequest,
} from "../../api/feedback/list-portal-my-feedback";
export function useListPortalMyFeedback(
  input: ListPortalMyFeedbackRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery({
    ...listPortalMyFeedbackInfiniteQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
