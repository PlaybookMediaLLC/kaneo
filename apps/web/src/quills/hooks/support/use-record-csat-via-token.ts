import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  recordCsatViaToken,
  type RecordCsatViaTokenRequest,
  type RecordCsatViaTokenResponse,
} from "../../api/support/record-csat-via-token";
export function useRecordCsatViaToken(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    RecordCsatViaTokenResponse,
    PortalProblem,
    RecordCsatViaTokenRequest
  >({
    mutationFn: (input) => recordCsatViaToken(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "support",
          "validateCsatEmailToken",
        ),
      });
    },
  });
}
