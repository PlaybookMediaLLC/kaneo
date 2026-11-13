import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  recordPortalAccessDenied,
  type RecordPortalAccessDeniedRequest,
  type RecordPortalAccessDeniedResponse,
} from "../../api/portal/record-portal-access-denied";
export function useRecordPortalAccessDenied(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RecordPortalAccessDeniedResponse,
    PortalProblem,
    RecordPortalAccessDeniedRequest
  >({
    mutationFn: (input) => recordPortalAccessDenied(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "getPublicPortalConfig",
        ),
      });
    },
  });
}
