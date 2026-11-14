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
    // The key has no source text, so each toggle asks the server again and its cache answers.
    // An edited text then never shows an old translation. A hidden translation is dropped.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    // A refusal spends an AI request and the rate limit: never retry it.
    retry: false,
  });
}
