import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  sendPostUpdate,
  type SendPostUpdateRequest,
  type SendPostUpdateResponse,
} from "../../api/team/send-post-update";
export function useSendPostUpdate(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SendPostUpdateResponse,
    PortalProblem,
    SendPostUpdateRequest
  >({
    mutationFn: (input) => sendPostUpdate(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPostComments",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getPost",
          ),
        }),
      ]);
    },
  });
}
