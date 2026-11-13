import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createPortalUpload,
  type CreatePortalUploadRequest,
  type CreatePortalUploadResponse,
} from "../../api/files/create-portal-upload";
export function useCreatePortalUpload(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreatePortalUploadResponse,
    PortalProblem,
    CreatePortalUploadRequest
  >({
    mutationFn: (input) => createPortalUpload(input),
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
