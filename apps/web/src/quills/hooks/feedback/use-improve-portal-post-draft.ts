import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  improvePortalPostDraftQuery,
  type ImprovePortalPostDraftRequest,
} from "../../api/feedback/improve-portal-post-draft";
export function useImprovePortalPostDraft(
  input: ImprovePortalPostDraftRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...improvePortalPostDraftQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
    // Each call spends an AI request and the rate limit: keep the answer, never retry a refusal.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
