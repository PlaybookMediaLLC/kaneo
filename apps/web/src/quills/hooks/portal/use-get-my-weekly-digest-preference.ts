import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getMyWeeklyDigestPreferenceQuery,
  type GetMyWeeklyDigestPreferenceRequest,
} from "../../api/portal/get-my-weekly-digest-preference";
export function useGetMyWeeklyDigestPreference(
  input: GetMyWeeklyDigestPreferenceRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getMyWeeklyDigestPreferenceQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
