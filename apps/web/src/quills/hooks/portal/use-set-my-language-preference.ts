import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setMyLanguagePreference,
  type SetMyLanguagePreferenceRequest,
  type SetMyLanguagePreferenceResponse,
} from "../../api/portal/set-my-language-preference";
export function useSetMyLanguagePreference(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetMyLanguagePreferenceResponse,
    PortalProblem,
    SetMyLanguagePreferenceRequest
  >({
    mutationFn: (input) => setMyLanguagePreference(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "getMyLanguagePreference",
        ),
      });
    },
  });
}
