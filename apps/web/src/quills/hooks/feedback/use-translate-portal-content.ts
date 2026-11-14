import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  translatePortalContentQuery,
  type TranslatePortalContentRequest,
} from "../../api/feedback/translate-portal-content";
export function useTranslatePortalContent(
  input: TranslatePortalContentRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...translatePortalContentQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
    // Each call spends an AI request and the rate limit: keep the answer, never retry a refusal.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
