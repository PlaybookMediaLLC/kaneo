import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  previewUnsubscribeTokenQuery,
  type PreviewUnsubscribeTokenRequest,
} from "../../api/notifications/preview-unsubscribe-token";
export function usePreviewUnsubscribeToken(
  input: PreviewUnsubscribeTokenRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...previewUnsubscribeTokenQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.query.token),
  });
}
