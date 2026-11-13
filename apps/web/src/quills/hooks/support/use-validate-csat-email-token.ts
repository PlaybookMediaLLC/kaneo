import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  validateCsatEmailTokenQuery,
  type ValidateCsatEmailTokenRequest,
} from "../../api/support/validate-csat-email-token";
export function useValidateCsatEmailToken(
  input: ValidateCsatEmailTokenRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...validateCsatEmailTokenQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.query.token),
  });
}
