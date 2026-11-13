import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  preparePortalUpload,
  type PreparePortalUploadRequest,
  type PreparePortalUploadResponse,
} from "../../api/files/prepare-portal-upload";
export function usePreparePortalUpload(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    PreparePortalUploadResponse,
    PortalProblem,
    PreparePortalUploadRequest
  >({
    mutationFn: (input) => preparePortalUpload(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "files",
          "getPortalFile",
        ),
      });
    },
  });
}
