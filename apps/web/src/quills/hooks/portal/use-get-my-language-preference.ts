import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getMyLanguagePreferenceQuery,
  type GetMyLanguagePreferenceRequest,
} from "../../api/portal/get-my-language-preference";
export function useGetMyLanguagePreference(
  input: GetMyLanguagePreferenceRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getMyLanguagePreferenceQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
