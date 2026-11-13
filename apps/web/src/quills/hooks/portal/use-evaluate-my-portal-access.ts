import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  evaluateMyPortalAccessQuery,
  type EvaluateMyPortalAccessRequest,
} from "../../api/portal/evaluate-my-portal-access";
export function useEvaluateMyPortalAccess(
  input: EvaluateMyPortalAccessRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...evaluateMyPortalAccessQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
