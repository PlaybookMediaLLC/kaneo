import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  resolvePublicHelpCenterRedirectQuery,
  type ResolvePublicHelpCenterRedirectRequest,
} from "../../api/help-center/resolve-public-help-center-redirect";
export function useResolvePublicHelpCenterRedirect(
  input: ResolvePublicHelpCenterRedirectRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...resolvePublicHelpCenterRedirectQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.query.path),
  });
}
