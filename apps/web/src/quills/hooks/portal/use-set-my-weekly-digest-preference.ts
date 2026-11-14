import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setMyWeeklyDigestPreference,
  type SetMyWeeklyDigestPreferenceRequest,
  type SetMyWeeklyDigestPreferenceResponse,
} from "../../api/portal/set-my-weekly-digest-preference";
export function useSetMyWeeklyDigestPreference(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetMyWeeklyDigestPreferenceResponse,
    PortalProblem,
    SetMyWeeklyDigestPreferenceRequest
  >({
    mutationFn: (input) => setMyWeeklyDigestPreference(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "getMyWeeklyDigestPreference",
        ),
      });
    },
  });
}
