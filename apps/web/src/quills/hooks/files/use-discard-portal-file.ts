import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  discardPortalFile,
  type DiscardPortalFileRequest,
  type DiscardPortalFileResponse,
} from "../../api/files/discard-portal-file";
export function useDiscardPortalFile(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    DiscardPortalFileResponse,
    PortalProblem,
    DiscardPortalFileRequest
  >({
    mutationFn: (input) => discardPortalFile(input),
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
